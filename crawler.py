import os
import datetime
import sys
import json
import time
import re
import argparse
import asyncio
import random
import logging
from playwright.async_api import async_playwright

# Setup logging configuration
os.makedirs("logs", exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("logs/scraper.log", encoding="utf-8")
    ]
)
logger = logging.getLogger("threads_scraper")

# Default search themes
DEFAULT_THEMES = ["AI", "台股", "旅遊", "美食"]

def parse_time_str(time_str):
    """
    Parse relative time strings (like "3h", "12m", "1天", "剛剛") or absolute date strings
    (like "01/26/26", "2026-1-26", "2026年1月26日", "5月3日", "May 3") into a Unix timestamp.
    """
    import datetime
    now = int(time.time())
    if not time_str:
        return now
        
    time_str = time_str.lower().strip()
    
    now_dt = datetime.datetime.now()
    current_year = now_dt.year
    
    months_map = {
        "jan": 1, "january": 1,
        "feb": 2, "february": 2,
        "mar": 3, "march": 3,
        "apr": 4, "april": 4,
        "may": 5,
        "jun": 6, "june": 6,
        "jul": 7, "july": 7,
        "aug": 8, "august": 8,
        "sep": 9, "september": 9,
        "oct": 10, "october": 10,
        "nov": 11, "november": 11,
        "dec": 12, "december": 12
    }
    
    # 1. Check Chinese style with year: "2026年1月26日"
    zh_year_match = re.search(r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?", time_str)
    if zh_year_match:
        try:
            dt = datetime.datetime(int(zh_year_match.group(1)), int(zh_year_match.group(2)), int(zh_year_match.group(3)))
            return int(dt.timestamp())
        except Exception:
            pass
            
    # 2. Check Chinese style without year: "5月3日"
    zh_noyear_match = re.search(r"(\d{1,2})\s*月\s*(\d{1,2})\s*日?", time_str)
    if zh_noyear_match:
        try:
            dt = datetime.datetime(current_year, int(zh_noyear_match.group(1)), int(zh_noyear_match.group(2)))
            if dt > now_dt + datetime.timedelta(days=1):
                dt = datetime.datetime(current_year - 1, int(zh_noyear_match.group(1)), int(zh_noyear_match.group(2)))
            return int(dt.timestamp())
        except Exception:
            pass

    # 3. Check English style with/without year: "Dec 19, 2025" or "May 3"
    for m_name, m_val in months_map.items():
        if m_name in time_str:
            year_match = re.search(r"\b(20\d{2})\b", time_str)
            time_without_year = time_str.replace(year_match.group(1), "") if year_match else time_str
            day_match = re.search(r"\b(\d{1,2})\b", time_without_year)
            if year_match and day_match:
                try:
                    dt = datetime.datetime(int(year_match.group(1)), m_val, int(day_match.group(1)))
                    return int(dt.timestamp())
                except Exception:
                    pass
            elif day_match:
                try:
                    dt = datetime.datetime(current_year, m_val, int(day_match.group(1)))
                    if dt > now_dt + datetime.timedelta(days=1):
                        dt = datetime.datetime(current_year - 1, m_val, int(day_match.group(1)))
                    return int(dt.timestamp())
                except Exception:
                    pass

    # 4. Check standard YYYY-MM-DD
    dash_match = re.search(r"(\d{4})-(\d{1,2})-(\d{1,2})", time_str)
    if dash_match:
        try:
            dt = datetime.datetime(int(dash_match.group(1)), int(dash_match.group(2)), int(dash_match.group(3)))
            return int(dt.timestamp())
        except Exception:
            pass

    # 5. Check slash separated: 01/26/26 or 2026/1/26 or 5/3
    if "/" in time_str:
        parts = [p.strip() for p in time_str.split("/") if p.strip()]
        try:
            if len(parts) == 3:
                if len(parts[0]) == 4: # YYYY/MM/DD
                    dt = datetime.datetime(int(parts[0]), int(parts[1]), int(parts[2]))
                else: # Assume MM/DD/YY or MM/DD/YYYY
                    month = int(parts[0])
                    day = int(parts[1])
                    year = int(parts[2])
                    if year < 100:
                        year += 2000
                    dt = datetime.datetime(year, month, day)
                return int(dt.timestamp())
            elif len(parts) == 2: # MM/DD or M/D (current year)
                month = int(parts[0])
                day = int(parts[1])
                dt = datetime.datetime(current_year, month, day)
                if dt > now_dt + datetime.timedelta(days=1):
                    dt = datetime.datetime(current_year - 1, month, day)
                return int(dt.timestamp())
        except Exception:
            pass

    # 6. Check relative time strings
    try:
        digits_match = re.search(r"\d+", time_str)
        if not digits_match:
            if any(w in time_str for w in ["剛剛", "now", "just"]):
                return now
            return now
            
        val = int(digits_match.group())
        
        if any(unit in time_str for unit in ["秒", "s"]):
            return now - val
        elif any(unit in time_str for unit in ["分", "m"]):
            return now - val * 60
        elif any(unit in time_str for unit in ["小時", "h", "hr"]):
            return now - val * 3600
        elif any(unit in time_str for unit in ["天", "d"]):
            return now - val * 86400
        elif any(unit in time_str for unit in ["週", "w"]):
            return now - val * 86400 * 7
        elif any(unit in time_str for unit in ["年", "y"]):
            return now - val * 86400 * 365
    except Exception:
        pass
        
    return now

async def scrape_theme(page, theme_name, theme_query, scrolls=2):
    """
    Scrapes threads.com/search?q={theme_query} and returns a list of post dictionaries.
    """
    url = f"https://www.threads.com/search?q={theme_query}"
    max_retries = 3
    
    for attempt in range(1, max_retries + 1):
        logger.info(f"Navigating to search page: {url} (Theme: {theme_name}, Attempt: {attempt}/{max_retries})")
        posts = []
        try:
            # Navigate and wait until network is stable
            await page.goto(url, wait_until="networkidle", timeout=25000)
            
            # Let's wait a bit to settle
            await page.wait_for_timeout(3000)
            
            # Try to remove the login modal if any
            try:
                await page.evaluate("""() => {
                    let dialogs = document.querySelectorAll('div[role="dialog"]');
                    dialogs.forEach(el => el.remove());
                    
                    document.body.style.overflow = 'auto';
                    document.body.style.setProperty('overflow', 'auto', 'important');
                }""")
            except Exception as modal_err:
                logger.warning(f"Failed to cleanup modal overlays: {modal_err}")

            # Scroll to load more posts
            for i in range(scrolls):
                logger.info(f"Scrolling... ({i+1}/{scrolls})")
                await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                scroll_delay = random.uniform(1.5, 3.2)
                time.sleep(scroll_delay)

            # Run JS to extract post details using the class-independent selector algorithm
            extracted_data = await page.evaluate(r"""() => {
                function getTimestampScore(text) {
                    if (!text) return -1;
                    text = text.trim().toLowerCase();
                    if (text === '') return -1;
                    
                    if (/^\d{4}[年\-\/]\d{1,2}[月\-\/]\d{1,2}/.test(text)) return 10;
                    if (/^\d{1,2}[月\-\/]\d{1,2}/.test(text)) return 9;
                    if (/^\d+[hmdswy]$/.test(text)) return 8;
                    if (/^\d+\s*(天|小時|分鐘|分|秒|週|週前|天前|小時前|分鐘前|秒前)/.test(text)) return 8;
                    if (text === '剛剛' || text === 'now' || text === 'just now') return 7;
                    
                    if (text.includes('讚') || text.includes('like') || text.includes('回覆') || text.includes('replies') || text.includes('repost') || text.includes('share') || text.includes('分享') || text.includes('翻譯')) {
                        return 0;
                    }
                    return 1;
                }

                let postLinks = Array.from(document.querySelectorAll('a[href*="/post/"]'));
                let uniquePosts = {};
                
                postLinks.forEach(link => {
                    let href = link.getAttribute('href');
                    if (!href) return;
                    let postIdMatch = href.match(/\/post\/([A-Za-z0-9_\-]+)/);
                    if (!postIdMatch) return;
                    let postId = postIdMatch[1];
                    
                    let cleanHref = href.split('/media')[0].split('/embed')[0].split('?')[0];
                    if (cleanHref.endsWith('/')) {
                        cleanHref = cleanHref.slice(0, -1);
                    }
                    
                    let text = link.textContent ? link.textContent.trim() : '';
                    let score = getTimestampScore(text);
                    
                    if (!uniquePosts[postId] || score > uniquePosts[postId].score) {
                        uniquePosts[postId] = {
                            link: link,
                            href: cleanHref,
                            score: score,
                            text: text
                        };
                    }
                });
                
                let uniqueLinks = Object.values(uniquePosts);
                let results = [];
                
                uniqueLinks.forEach(item => {
                    let link = item.link;
                    let href = item.href;
                    let postIdMatch = href.match(/\/post\/([A-Za-z0-9_\-]+)/);
                    if (!postIdMatch) return;
                    let postId = postIdMatch[1];
                    
                    // Class-independent container detection
                    let postContainer = link;
                    while (postContainer.parentElement) {
                        let parent = postContainer.parentElement;
                        let otherPostLinks = Array.from(parent.querySelectorAll('a[href*="/post/"]'));
                        let hasOtherPosts = otherPostLinks.some(l => {
                            let h = l.getAttribute('href');
                            return h && !h.includes('/post/' + postId);
                        });
                        if (hasOtherPosts) {
                            break;
                        }
                        postContainer = parent;
                    }
                    
                    if (!postContainer) return;
                    
                    // Extract Username and User Link
                    let allLinks = Array.from(postContainer.querySelectorAll('a'));
                    let userLink = allLinks.find(l => {
                        let h = l.getAttribute('href');
                        return h && h.includes('/@') && !h.includes('/post/');
                    });
                    
                    let username = 'unknown';
                    let user_url = '';
                    if (userLink) {
                        let href = userLink.getAttribute('href');
                        username = href.replace('/', '').replace('@', '');
                        user_url = 'https://www.threads.com' + href;
                    } else {
                        let match = href.match(/\/@([^/]+)\/post\//);
                        if (match) {
                            username = match[1];
                            user_url = 'https://www.threads.com/@' + username;
                        }
                    }
                    
                    // Extract Post Text (longest dir="auto" span)
                    let spans = Array.from(postContainer.querySelectorAll('span[dir="auto"]'));
                    let post_text = '';
                    spans.forEach(span => {
                        let text = span.textContent.trim();
                        if (text && text !== username && !text.includes('翻譯') && !text.includes('翻譯年糕') && !/^\d+\s*(讚|回覆|likes|replies|reposts|shares|個讚|則回覆)/i.test(text)) {
                            if (text.length > post_text.length) {
                                post_text = text;
                            }
                        }
                    });
                    
                    // Extract Likes and Replies counts
                    let likes = 0;
                    let replies = 0;
                    let article_text = postContainer.textContent || '';
                    
                    function parseCount(txt, type) {
                        let regexes = [];
                        if (type === 'likes') {
                            regexes = [
                                /Like\s*([\d\.]+K?)/i,
                                /([\d\.]+K?)\s*(likes|讚|個讚)/i
                            ];
                        } else {
                            regexes = [
                                /Comment\s*([\d\.]+K?)/i,
                                /([\d\.]+K?)\s*(replies|回覆|則回覆|個回覆)/i
                            ];
                        }
                        
                        for (let r of regexes) {
                            let m = txt.match(r);
                            if (m) {
                                let valStr = m[1].toUpperCase();
                                if (valStr.includes('K')) {
                                    return Math.round(parseFloat(valStr.replace('K', '')) * 1000);
                                }
                                return parseInt(valStr) || 0;
                            }
                        }
                        return 0;
                    }
                    
                    likes = parseCount(article_text, 'likes');
                    replies = parseCount(article_text, 'replies');
                    
                    results.push({
                        id: postId,
                        username: username,
                        user_url: user_url,
                        text: post_text || '無內文',
                        url: 'https://www.threads.com' + href,
                        likes: likes,
                        replies: replies,
                        time_str: item.text
                    });
                });
                return results;
            }""")
            
            # Convert extracted times and add additional metadata in Python
            for item in extracted_data:
                post_time = parse_time_str(item["time_str"])
                posts.append({
                    "id": item["id"],
                    "username": item["username"],
                    "user_url": item["user_url"],
                    "text": item["text"],
                    "url": item["url"],
                    "likes": item["likes"],
                    "replies": item["replies"],
                    "time": post_time,
                    "time_str": item["time_str"],
                    "theme": theme_name,
                    "last_seen": int(time.time()),
                    "source": "Threads Web"
                })
                
            if not posts:
                raise ValueError("No posts extracted from search results (empty page response)")
                
            logger.info(f"Successfully scraped {len(posts)} posts for theme: {theme_name}")
            return posts
            
        except Exception as e:
            if attempt < max_retries:
                sleep_time = (2 ** attempt) + random.uniform(1, 3)
                logger.info(f"[Retry System] Attempt {attempt}/3 failed for theme {theme_name}. Retrying in {sleep_time:.2f} seconds...")
                await asyncio.sleep(sleep_time)
            else:
                logger.error(f"All {max_retries} attempts failed to scrape theme {theme_name}: {e}")
                
    return []

def load_config():
    # Default is list of dicts mapping name to query
    themes = [{"name": t, "query": t} for t in DEFAULT_THEMES]
    scrolls = 2
    only_today = False
    if os.path.exists("config.json"):
        try:
            with open("config.json", "r", encoding="utf-8") as f:
                cfg = json.load(f)
                if isinstance(cfg, dict):
                    if "themes" in cfg:
                        raw_themes = cfg["themes"]
                        if isinstance(raw_themes, dict):
                            themes = [{"name": str(k).strip(), "query": str(v).strip()} for k, v in raw_themes.items() if str(k).strip() and str(v).strip()]
                        elif isinstance(raw_themes, list):
                            normalized = []
                            for item in raw_themes:
                                if isinstance(item, dict) and "name" in item and "query" in item:
                                    normalized.append({"name": str(item["name"]).strip(), "query": str(item["query"]).strip()})
                                elif isinstance(item, str) and item.strip():
                                    normalized.append({"name": item.strip(), "query": item.strip()})
                            if normalized:
                                themes = normalized
                    if "scrolls" in cfg and isinstance(cfg["scrolls"], int):
                        scrolls = cfg["scrolls"]
                    if "only_today" in cfg and isinstance(cfg["only_today"], bool):
                        only_today = cfg["only_today"]
            logger.info(f"Loaded configuration from config.json: themes={themes}, scrolls={scrolls}, only_today={only_today}")
        except Exception as e:
            logger.warning(f"Failed to read config.json: {e}")
    return themes, scrolls, only_today

async def main_async(args):
    start_time = int(time.time())
    # Load existing database
    existing_posts = {}
    if not args.init and os.path.exists("data.json"):
        try:
            with open("data.json", "r", encoding="utf-8") as f:
                data_list = json.load(f)
                for item in data_list:
                    # Set default first_seen and last_seen
                    if "first_seen" not in item:
                        item["first_seen"] = item.get("time", int(time.time()))
                    if "last_seen" not in item:
                        item["last_seen"] = int(time.time())
                    if "source" not in item:
                        item["source"] = "Threads Web"
                    key = item.get("id") or item.get("url")
                    if key:
                        existing_posts[key] = item
            logger.info(f"Loaded {len(existing_posts)} existing posts from database.")
        except Exception as e:
            logger.error(f"Failed to load data.json: {e}")

    # Set up themes
    themes = args.themes_list
    logger.info(f"Starting crawler for themes: {themes}")

    # Calculate today's start timestamp in Taipei (UTC+8)
    only_today = getattr(args, "only_today_val", False)
    today_start_timestamp = 0
    if only_today:
        tz = datetime.timezone(datetime.timedelta(hours=8))
        now_local = datetime.datetime.now(tz)
        today_start_local = datetime.datetime(now_local.year, now_local.month, now_local.day, tzinfo=tz)
        today_start_timestamp = int(today_start_local.timestamp())
        logger.info(f"Filter enabled: Only keeping posts published today (since {today_start_local}, timestamp: {today_start_timestamp})")

    new_posts_count = 0
    updated_posts_count = 0

    browser = None
    try:
        async with async_playwright() as p:
            logger.info("Launching headless Chromium...")
            # Add arguments to make it run smoothly in docker/actions
            browser = await p.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-web-security"
                ]
            )
            context = await browser.new_context(
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
                locale="zh-TW",
                timezone_id="Asia/Taipei",
                viewport={"width": 1920, "height": 1080}
            )
            
            page = await context.new_page()
            
            # Navigate directly to search pages to avoid setting cookies that trigger the login wall

            for theme_cfg in themes:
                theme_name = theme_cfg["name"]
                theme_query = theme_cfg["query"]
                theme_posts = await scrape_theme(page, theme_name, theme_query, scrolls=args.scrolls_val)
                logger.info(f"Successfully scraped {len(theme_posts)} posts for theme: {theme_name}")
                
                # Merge with existing posts
                for post in theme_posts:
                    if only_today and post.get("time", 0) < today_start_timestamp:
                        continue
                    
                    # Ensure post is within 72 hours of crawler execution start time
                    post_time = post.get("time", 0)
                    if start_time - post_time > 259200: # 72 hours
                        logger.info(f"Skipping newly scraped post {post.get('id')} because it is older than 72 hours ({post.get('time_str')})")
                        continue
                        
                    key = post.get("id") or post.get("url")
                    if not key:
                        continue
                    if key in existing_posts:
                        # Update metrics and last_seen
                        existing_posts[key]["likes"] = post.get("likes", 0)
                        existing_posts[key]["replies"] = post.get("replies", 0)
                        existing_posts[key]["last_seen"] = post.get("last_seen", int(time.time()))
                        # Retain first_seen
                        updated_posts_count += 1
                    else:
                        # New post
                        post["first_seen"] = post.get("time", int(time.time()))
                        existing_posts[key] = post
                        new_posts_count += 1
                
                # Sleep between themes to avoid blocking
                delay = 3.0
                logger.info(f"Waiting {delay} seconds before next theme...")
                await page.wait_for_timeout(int(delay * 1000))
    except Exception as e:
        logger.error(f"Fatal error during crawler execution: {e}")
        raise e
    finally:
        if browser:
            logger.info("Closing Playwright browser context gracefully...")
            await browser.close()

    # Automatically clean up posts older than 72 hours of publication age
    now = int(time.time())
    filtered_posts = {}
    for pid, pdata in existing_posts.items():
        # Keep only posts published within the last 72 hours
        if now - pdata.get("time", now) <= 259200:
            filtered_posts[pid] = pdata
            
    removed_count = len(existing_posts) - len(filtered_posts)
    if removed_count > 0:
        logger.info(f"Cleaned up {removed_count} posts older than 72 hours.")
        
    output_list = list(filtered_posts.values())
    
    # Sort posts by time descending (newest first)
    output_list.sort(key=lambda x: x.get("time", 0), reverse=True)

    # Save to data.json
    with open("data.json", "w", encoding="utf-8") as f:
        json.dump(output_list, f, indent=2, ensure_ascii=False)
        
    # Save to data.js for direct frontend browser load (bypassing CORS)
    with open("data.js", "w", encoding="utf-8") as f:
        f.write("window.crawledData = ")
        json.dump(output_list, f, indent=2, ensure_ascii=False)
        f.write(";\n")

    logger.info("Scraper completed successfully.")
    logger.info(f"New posts added: {new_posts_count}")
    logger.info(f"Existing posts updated: {updated_posts_count}")
    logger.info(f"Total active posts in database: {len(output_list)}")

def main():
    parser = argparse.ArgumentParser(description="Threads public opinion scraper")
    parser.add_argument("--scrolls", type=int, default=None, help="Number of times to scroll down to load more posts")
    parser.add_argument("--themes", type=str, default=None, help="Comma-separated list of themes to scrape")
    parser.add_argument("--init", action="store_true", help="Clear old data and run a clean crawl")
    parser.add_argument("--only-today", action="store_true", default=None, help="Only scrape posts published on the current day")
    args = parser.parse_args()
    
    # Load config file values
    cfg_themes, cfg_scrolls, cfg_only_today = load_config()
    
    # Override with command line arguments if provided
    if args.themes is not None:
        args.themes_list = [{"name": t.strip(), "query": t.strip()} for t in args.themes.split(",") if t.strip()]
    else:
        args.themes_list = cfg_themes
        
    if args.scrolls is not None:
        args.scrolls_val = args.scrolls
    else:
        args.scrolls_val = cfg_scrolls
        
    if args.only_today is not None:
        args.only_today_val = args.only_today
    else:
        args.only_today_val = cfg_only_today
        
    asyncio.run(main_async(args))

if __name__ == "__main__":
    main()

