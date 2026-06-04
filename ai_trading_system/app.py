import os
import sys
import time
import json
import math
import hashlib
import datetime
import requests
import yfinance as yf
import google.generativeai as genai
from dotenv import load_dotenv

# Load local environment variables (if any)
load_dotenv()

# System Config / Env Variables
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
DISCORD_WEBHOOK_URL = os.getenv("DISCORD_WEBHOOK_URL")

# Validate required variables
missing_vars = []
if not GEMINI_API_KEY: missing_vars.append("GEMINI_API_KEY")
if not SUPABASE_URL: missing_vars.append("SUPABASE_URL")
if not SUPABASE_KEY: missing_vars.append("SUPABASE_KEY")
if not DISCORD_WEBHOOK_URL: missing_vars.append("DISCORD_WEBHOOK_URL")

if missing_vars:
    print(f"[SYSTEM WARNING] Missing environment variables: {', '.join(missing_vars)}")
    print("[SYSTEM WARNING] Ensure these are set in your environment or in a local .env file.")

# Configure Gemini AI
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
    gemini_model = genai.GenerativeModel('gemini-2.5-flash')
else:
    gemini_model = None

# Global Macro Indicators Cache
macro_cache = {
    "us10y": 4.25,        # Fallback default yield (%)
    "usdtwd": 31.5,       # Fallback default exchange rate
    "last_update": 0.0    # Unix timestamp
}

def update_macro_cache():
    """
    Updates the macro cache using yfinance.
    Failsafe: retains existing cache or defaults if fetches fail.
    """
    global macro_cache
    now = time.time()
    
    # Update only if 1 hour (3600 seconds) has elapsed since last update
    if now - macro_cache["last_update"] < 3600 and macro_cache["last_update"] > 0:
        return

    print("[MACRO CACHE] Fetching macroeconomic indicators from yfinance...")
    
    # Fetch US 10-Year Treasury Yield (^TNX)
    try:
        tnx = yf.Ticker("^TNX")
        hist_tnx = tnx.history(period="5d")
        if not hist_tnx.empty:
            val = hist_tnx['Close'].iloc[-1]
            if val is not None and not math.isnan(val) and val > 0:
                macro_cache["us10y"] = round(float(val), 3)
                print(f"[MACRO CACHE] US10Y Yield updated to {macro_cache['us10y']}%")
    except Exception as e:
        print(f"[MACRO CACHE] Failed to fetch US10Y (^TNX): {e}")

    # Fetch USD/TWD exchange rate (USDTWD=X)
    try:
        usdtwd = yf.Ticker("USDTWD=X")
        hist_twd = usdtwd.history(period="5d")
        if not hist_twd.empty:
            val = hist_twd['Close'].iloc[-1]
            if val is not None and not math.isnan(val) and val > 0:
                macro_cache["usdtwd"] = round(float(val), 3)
                print(f"[MACRO CACHE] USDTWD Exchange Rate updated to {macro_cache['usdtwd']}")
    except Exception as e:
        print(f"[MACRO CACHE] Failed to fetch USDTWD=X: {e}")

    macro_cache["last_update"] = now
    print(f"[MACRO CACHE] Cache sync complete. US10Y: {macro_cache['us10y']}%, USDTWD: {macro_cache['usdtwd']}")

def get_cls_signature(params):
    """
    Calculates SHA1 -> MD5 signature for CLS API.
    """
    sorted_keys = sorted(params.keys())
    param_pairs = [f"{k}={params[k]}" for k in sorted_keys]
    param_str = "&".join(param_pairs)
    
    sha1 = hashlib.sha1(param_str.encode('utf-8')).hexdigest()
    md5 = hashlib.md5(sha1.encode('utf-8')).hexdigest()
    return md5, param_str

def poll_cls_news():
    """
    Polls the latest rolling news from CLS.
    """
    # Fallback urls if cc-api fails to resolve
    domains = ["https://cc-api.cls.cn", "https://vip-api.cls.cn", "https://www.cls.cn"]
    path = "/v1/roll/get_roll_list"
    
    params = {
        "app": "CailianpressWeb",
        "os": "web",
        "rn": "20",
        "sv": "7.7.5",
        "last_time": str(int(time.time()))
    }
    
    sign, param_str = get_cls_signature(params)
    url_params = f"{param_str}&sign={sign}"
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://www.cls.cn/telegraph"
    }

    last_err = None
    for domain in domains:
        full_url = f"{domain}{path}?{url_params}"
        try:
            print(f"[POLLER] Requesting CLS roll news from {domain}...")
            r = requests.get(full_url, headers=headers, timeout=10)
            if r.status_code == 200:
                res_json = r.json()
                # Check for standard CLS response structure
                if res_json.get("code") == 0 or "data" in res_json:
                    data = res_json.get("data")
                    if isinstance(data, list):
                        return data
                    elif isinstance(data, dict):
                        return data.get("roll_data") or data.get("roll_list") or data.get("list") or []
            else:
                print(f"[POLLER] Domain {domain} returned status code {r.status_code}")
        except Exception as e:
            last_err = e
            print(f"[POLLER] Failed to connect to {domain}: {e}")
            
    # If all CLS domains fail, attempt to fetch from community RSSHub instances
    print("[POLLER] CLS domains did not return data. Attempting public RSSHub instances...")
    rsshub_instances = [
        "https://rss.rsshub.app",
        "https://hub.sl.al",
        "https://rsshub.daily-apis.com"
    ]
    for ins in rsshub_instances:
        url = f"{ins}/cls/telegraph.json"
        try:
            print(f"[POLLER] Requesting CLS telegraph feed from RSSHub: {ins}...")
            r = requests.get(url, headers={"User-Agent": headers["User-Agent"]}, timeout=10)
            if r.status_code == 200:
                res_data = r.json()
                items = res_data.get("items") or []
                news_list = []
                import re
                for item in items:
                    title_text = item.get("title") or ""
                    content_text = item.get("content_html") or item.get("summary") or ""
                    content_clean = re.sub(r'<[^>]+>', '', content_text) # Strip HTML tags
                    
                    # Generate a unique string ID based on title/url if ID is URL format
                    raw_id = str(item.get("id") or "")
                    clean_id = raw_id.split('/')[-1] if '/' in raw_id else raw_id
                    
                    news_list.append({
                        "id": clean_id,
                        "title": title_text,
                        "content": content_clean,
                        "ctime": int(time.time())
                    })
                if news_list:
                    print(f"[POLLER] Successfully fetched {len(news_list)} items from RSSHub ({ins})")
                    return news_list
        except Exception as e:
            print(f"[POLLER] RSSHub instance {ins} failed: {e}")
            
    # If all fail, raise exception to trigger loop retry logic
    raise last_err or Exception("All CLS domains and RSSHub fallbacks failed to respond.")

def fetch_db_whitelist():
    """
    Fetches the dynamic whitelist config from Supabase.
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("[WHITELIST] Supabase environment variables not configured. Using local defaults.")
        return "台積電,2330,聯發科,2454,NVDA,輝達,TSLA,特斯拉,聯準會,Fed,CPI,非農"

    url = f"{SUPABASE_URL}/rest/v1/system_config?key=eq.white_list"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}"
    }
    try:
        r = requests.get(url, headers=headers, timeout=10)
        if r.status_code == 200:
            data = r.json()
            if isinstance(data, list) and len(data) > 0:
                val = data[0].get("value")
                if val:
                    print(f"[WHITELIST] Loaded dynamic term whitelist from database.")
                    return val
        print(f"[WHITELIST] Database returned status {r.status_code}. Using defaults.")
    except Exception as e:
        print(f"[WHITELIST] Error fetching whitelist from database: {e}")
    return "台積電,2330,聯發科,2454,NVDA,輝達,TSLA,特斯拉,聯準會,Fed,CPI,非農"

def evaluate_news_with_ai(title, content, whitelist_str):
    """
    Calls Gemini to evaluate news against whitelist and macro context.
    Returns parsed assessment dictionary or None if IGNORE is triggered.
    """
    if not gemini_model:
        # Dry-run placeholder if API key is missing
        print("[AI EVALUATION] Gemini API key not found. Skipping AI review.")
        return None

    us10y = macro_cache["us10y"]
    usdtwd = macro_cache["usdtwd"]
    
    prompt = f"""
You are a professional financial AI analyst.
Evaluate the following financial news based on the Whitelist and current Macroeconomic indicators.

---
[Current Macro Indicators Cache]
- US 10-Year Treasury Yield (^TNX): {us10y}%
- USD/TWD Exchange Rate (USDTWD=X): {usdtwd}

[Whitelist Core Entities and Events]
{whitelist_str}

---
[Financial News to Evaluate]
Title: {title}
Content: {content}

---
[Evaluation Rules]
1. Check if the news relates to the Whitelist Core Entities or Events. If NOT related, return standard JSON with `"relevant": false`.
2. If it is relevant, analyze the news impact on the market, factoring in the current US 10-Year yield ({us10y}%) and USD/TWD rate ({usdtwd}).
3. Output a standard JSON object containing:
   - "relevant": A boolean (true if the news is highly related to the whitelist entities or events, false if it should be ignored).
   - "summary": A concise fact summary (strictly under 30 characters in Traditional Chinese, required if relevant is true).
   - "sentiment": Sentiment label, must be exactly one of: "利多", "利空", or "中性" (required if relevant is true).
   - "score": An integer score between -3 and +3 (required if relevant is true).
   - "reason": A brief reason for the score (required if relevant is true).

Do not output any markdown formatting backticks (no ```json). Output only valid JSON.
"""
    try:
        generation_config = {
            "response_mime_type": "application/json"
        }
        
        response = gemini_model.generate_content(prompt, generation_config=generation_config)
        response_text = response.text.strip()
        
        # Clean markdown wrapper if it exists (extra precaution)
        if response_text.startswith("```json"):
            response_text = response_text[7:]
        if response_text.endswith("```"):
            response_text = response_text[:-3]
        response_text = response_text.strip()
        
        data = json.loads(response_text)
        
        if not data.get("relevant", False):
            return None
            
        summary = data.get("summary") or ""
        sentiment = data.get("sentiment") or "中性"
        score = data.get("score")
        reason = data.get("reason") or ""
        
        # Format checks
        if score is None:
            score = 0
        else:
            try:
                score = int(score)
            except ValueError:
                score = 0
        score = max(-3, min(3, score)) # Clamp between -3 and +3
        
        return {
            "summary": summary,
            "sentiment": sentiment,
            "score": score,
            "reason": reason
        }
    except Exception as e:
        print(f"[AI EVALUATION] Error analyzing news: {e}")
        # Secondary backup check for raw ignore text
        try:
            if "relevant" in response_text and "false" in response_text:
                return None
        except Exception:
            pass
        raise e

def save_to_database(news_id, title, assessment):
    """
    Saves evaluated signal to Supabase.
    Includes resolution=ignore-duplicates to prevent duplicate inserts.
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("[DATABASE] Supabase config not available. Skipping DB save.")
        return None

    url = f"{SUPABASE_URL}/rest/v1/market_news"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation,resolution=ignore-duplicates"
    }

    news_data = {
        "id": news_id,
        "source": "CLS",
        "original_title": title,
        "ai_summary": assessment["summary"],
        "sentiment": assessment["sentiment"],
        "total_score": assessment["score"],
        "raw_indicators": {
            "us10y": macro_cache["us10y"],
            "usdtwd": macro_cache["usdtwd"],
            "reason": assessment["reason"]
        }
    }

    try:
        r = requests.post(url, headers=headers, json=news_data, timeout=10)
        if r.status_code in [200, 201]:
            # Returns representation list. If empty, it was a duplicate and ignored.
            res_data = r.json()
            if isinstance(res_data, list) and len(res_data) > 0:
                print(f"[DATABASE] Saved new signal: ID={news_id}, Score={assessment['score']}")
                return res_data[0]
            else:
                print(f"[DATABASE] Duplicate signal ignored: ID={news_id}")
                return None
        else:
            print(f"[DATABASE] Insert failed (status={r.status_code}): {r.text}")
            return None
    except Exception as e:
        print(f"[DATABASE] Request error: {e}")
        return None

def send_discord_webhook(title, assessment):
    """
    Sends Discord Webhook rich embeds on scores >= 2 or <= -2.
    """
    if not DISCORD_WEBHOOK_URL:
        return

    score = assessment["score"]
    if abs(score) < 2:
        return

    # Green (0x00FF00 / 65280) for positive, Red (0xFF0000 / 16711680) for negative
    color = 65280 if score >= 0 else 16711680
    tag = "★ STRONG BUY" if score >= 2 else "⚠️ STRONG SELL"
    
    payload = {
        "embeds": [
            {
                "title": f"{tag} (AI Score: {score:+.0f})",
                "color": color,
                "fields": [
                    {"name": "AI 30字智慧摘要", "value": assessment["summary"], "inline": False},
                    {"name": "原始新聞標題", "value": title or "無標題", "inline": False},
                    {"name": "情緒分析", "value": f"標籤: **{assessment['sentiment']}**", "inline": True},
                    {"name": "總經數據背書", "value": f"美債殖利率: **{macro_cache['us10y']}%**\n台幣匯率: **{macro_cache['usdtwd']}**", "inline": True},
                    {"name": "AI 深度評估理由", "value": assessment["reason"] or "無詳細說明", "inline": False}
                ],
                "footer": {
                    "text": "QUANT-CORE TERMINAL"
                },
                "timestamp": datetime.datetime.utcnow().isoformat() + "Z"
            }
        ]
    }
    
    try:
        r = requests.post(DISCORD_WEBHOOK_URL, json=payload, timeout=10)
        if r.status_code == 204:
            print(f"[DISCORD] Alert sent for high impact signal (Score: {score})")
        else:
            print(f"[DISCORD] Failed to send alert: {r.status_code} - {r.text}")
    except Exception as e:
        print(f"[DISCORD] Webhook error: {e}")

def send_system_failure_notification(consecutive_count, error_msg):
    """
    Alerts Discord of continuous engine failures before entering sleep cooldown.
    """
    if not DISCORD_WEBHOOK_URL:
        return
        
    payload = {
        "embeds": [
            {
                "title": "🚨 QUANT-CORE ENGINE MALFUNCTION ALERT",
                "color": 16711680, # Red
                "description": f"The backend monitor engine has failed **{consecutive_count}** consecutive times. Entering a 5-minute cool-down phase.",
                "fields": [
                    {"name": "Last Registered Error", "value": str(error_msg), "inline": False}
                ],
                "timestamp": datetime.datetime.utcnow().isoformat() + "Z"
            }
        ]
    }
    try:
        requests.post(DISCORD_WEBHOOK_URL, json=payload, timeout=10)
        print("[DISCORD] Engine failure notification dispatched.")
    except Exception as e:
        print(f"[DISCORD] Failed to send engine status alert: {e}")

def run_loop(run_once=False):
    consecutive_failures = 0
    print("[SYSTEM START] Engine initialized. Entering main loop...")
    
    while True:
        try:
            # 1. Sync Macro indicators cache
            update_macro_cache()
            
            # 2. Get dynamic Whitelist
            whitelist_str = fetch_db_whitelist()
            keywords = [k.strip().lower() for k in whitelist_str.split(",") if k.strip()]
            
            # 3. Poll rolling financial news from CLS
            news_items = poll_cls_news()
            print(f"[POLLER] Fetched {len(news_items)} news items from Cailian Press.")
            
            # Process each news item
            for item in news_items:
                news_id = str(item.get("id") or item.get("news_id") or "")
                if not news_id:
                    continue
                
                title = item.get("title") or ""
                content = item.get("content") or ""
                
                # Pre-filter keywords locally to save Gemini API costs
                combined_text = (title + " " + content).lower()
                has_keyword = any(kw in combined_text for kw in keywords)
                
                if not has_keyword:
                    # Ignore silently
                    continue
                
                print(f"[AI EVALUATION] Keyword match found. Analyzing item ID={news_id}...")
                assessment = evaluate_news_with_ai(title, content, whitelist_str)
                
                if assessment is None:
                    # AI deemed it unrelated/ignore
                    print(f"[AI EVALUATION] Item ID={news_id} classified as IGNORE.")
                    continue
                
                # 4. Save to Database (returns data only if it is a new non-duplicate entry)
                saved_record = save_to_database(news_id, title, assessment)
                
                if saved_record:
                    # 5. Alert high impact signals to Discord Webhook
                    send_discord_webhook(title, assessment)
                    
            # Reset consecutive failures counter on successful iteration
            consecutive_failures = 0
            
            if run_once:
                print("[SYSTEM END] Single run completed successfully. Exiting.")
                break
                
            # Sleep 60 seconds before next polling iteration
            time.sleep(60)
            
        except Exception as e:
            consecutive_failures += 1
            print(f"[SYSTEM ERROR] Exception in main loop (Count={consecutive_failures}): {e}", file=sys.stderr)
            
            if run_once:
                print("[SYSTEM END] Single run encountered error. Exiting with failure.")
                sys.exit(1)
                
            if consecutive_failures >= 3:
                # Alert Discord and enter 5-minute cool-down
                send_system_failure_notification(consecutive_failures, e)
                consecutive_failures = 0
                print("[SYSTEM COOLDOWN] Force sleeping for 5 minutes...")
                time.sleep(300)
            else:
                # Sleep normal time before next retry
                time.sleep(60)

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="AI Trading Decision System Backend")
    parser.add_argument("--once", action="store_true", help="Run a single iteration and exit")
    args = parser.parse_args()
    
    run_loop(run_once=args.once)

