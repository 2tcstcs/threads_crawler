import os
import sys
import json
import time
import re
import argparse
import asyncio
from playwright.async_api import async_playwright

# Default search themes
DEFAULT_THEMES = ["AI", "台股", "旅遊", "美食"]

def parse_time_str(time_str):
    """
    Parse relative time strings (like "3h", "12m", "1天", "剛剛") or absolute date strings
    (like "01/26/26", "2026-1-26", "2026年1月26日") into a Unix timestamp.
    """
    import datetime
    now = int(time.time())
    if not time_str:
        return now
        
    time_str = time_str.lower().strip()
    
    # Check if absolute date
    if any(delim in time_str for delim in ["/", "-", "年"]):
        try:
            # Check Chinese style: "2026年1月26日"
            zh_match = re.search(r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日", time_str)
            if zh_match:
                dt = datetime.datetime(int(zh_match.group(1)), int(zh_match.group(2)), int(zh_match.group(3)))
                return int(dt.timestamp())
                
            # Check standard YYYY-MM-DD
            dash_match = re.search(r"(\d{4})-(\d{1,2})-(\d{1,2})", time_str)
            if dash_match:
                dt = datetime.datetime(int(dash_match.group(1)), int(dash_match.group(2)), int(dash_match.group(3)))
                return int(dt.timestamp())
                
            # If it's slash separated: 01/26/26 or 2026/1/26
            parts = [p.strip() for p in time_str.split("/") if p.strip()]
            if len(parts) == 3:
                if len(parts[0]) == 4: # YYYY/MM/DD
                    dt = datetime.datetime(int(parts[0]), int(parts[1]), int(parts[2]))
                else: # Assume MM/DD/YY or MM/DD/YYYY
                    month = int(parts[0])
                    day = int(parts[1])
                    year = int(parts[2])
                    if year < 100:
                        year += 2000 # Assume 21st century
                    dt = datetime.datetime(year, month, day)
                return int(dt.timestamp())
        except Exception as e:
            print(f"[Warning] Failed to parse absolute date '{time_str}': {e}")
            return now

    try:
        # Match digits
        digits_match = re.search(r"\d+", time_str)
        if not digits_match:
            return now
            
        val = int(digits_match.group())
        
        # Check units (English & Chinese)
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
    print(f"\n[Scraper] Navigating to: {url}")
    
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
            print(f"[Warning] Failed to cleanup modal overlays: {modal_err}")

        # Scroll to load more posts
        for i in range(scrolls):
            print(f"[Scraper] Scrolling... ({i+1}/{scrolls})")
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await page.wait_for_timeout(3000) # Wait 3 seconds for content to load



        # Run JS to extract post details using the class-independent selector algorithm
        extracted_data = await page.evaluate(r"""() => {
            let postLinks = Array.from(document.querySelectorAll('a[href*="/post/"]'));
            let uniqueHrefs = [];
            let uniqueLinks = [];
            
            postLinks.forEach(link => {
                let href = link.getAttribute('href');
                if (href && !uniqueHrefs.includes(href)) {
                    uniqueHrefs.push(href);
                    uniqueLinks.push(link);
                }
            });
            
            let results = [];
            
            uniqueLinks.forEach(link => {
                let href = link.getAttribute('href');
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
                    time_str: link.textContent.trim()
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
                "last_seen": int(time.time())
            })
            
    except Exception as e:
        print(f"[Error] Error scraping theme {theme}: {e}")
        
    return posts

def load_config():
    # Default is list of dicts mapping name to query
    themes = [{"name": t, "query": t} for t in DEFAULT_THEMES]
    scrolls = 2
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
            print(f"Loaded configuration from config.json: themes={themes}, scrolls={scrolls}")
        except Exception as e:
            print(f"[Warning] Failed to read config.json: {e}")
    return themes, scrolls

async def main_async(args):
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
                    existing_posts[item["id"]] = item
            print(f"Loaded {len(existing_posts)} existing posts from database.")
        except Exception as e:
            print(f"Failed to load data.json: {e}")

    # Set up themes
    themes = args.themes_list
    print(f"Starting crawler for themes: {themes}")

    new_posts_count = 0
    updated_posts_count = 0

    async with async_playwright() as p:
        print("Launching headless Chromium...")
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
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            locale="zh-TW",
            timezone_id="Asia/Taipei",
            viewport={"width": 1280, "height": 800}
        )
        
        page = await context.new_page()
        
        # Navigate directly to search pages to avoid setting cookies that trigger the login wall

        for theme_cfg in themes:
            theme_name = theme_cfg["name"]
            theme_query = theme_cfg["query"]
            theme_posts = await scrape_theme(page, theme_name, theme_query, scrolls=args.scrolls_val)
            print(f"Successfully scraped {len(theme_posts)} posts for theme: {theme_name}")
            
            # Merge with existing posts
            for post in theme_posts:
                pid = post["id"]
                if pid in existing_posts:
                    # Update metrics and last_seen
                    existing_posts[pid]["likes"] = post["likes"]
                    existing_posts[pid]["replies"] = post["replies"]
                    existing_posts[pid]["last_seen"] = post["last_seen"]
                    # Retain first_seen
                    updated_posts_count += 1
                else:
                    # New post
                    post["first_seen"] = post.get("time", int(time.time()))
                    existing_posts[pid] = post
                    new_posts_count += 1
            
            # Sleep between themes to avoid blocking
            delay = 3.0
            print(f"Waiting {delay} seconds before next theme...")
            await page.wait_for_timeout(int(delay * 1000))
            
        await browser.close()

    # Automatically clean up posts older than 7 days (604800 seconds)
    now = int(time.time())
    filtered_posts = {}
    for pid, pdata in existing_posts.items():
        # Keep if seen in the last 7 days OR posted in the last 7 days
        # This keeps the database from growing too large
        if now - pdata.get("last_seen", now) <= 604800:
            filtered_posts[pid] = pdata
            
    removed_count = len(existing_posts) - len(filtered_posts)
    if removed_count > 0:
        print(f"Cleaned up {removed_count} posts older than 7 days.")
        
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

    print(f"\n[Scraper Completed]")
    print(f"New posts added: {new_posts_count}")
    print(f"Existing posts updated: {updated_posts_count}")
    print(f"Total active posts in database: {len(output_list)}")

def main():
    parser = argparse.ArgumentParser(description="Threads public opinion scraper")
    parser.add_argument("--scrolls", type=int, default=None, help="Number of times to scroll down to load more posts")
    parser.add_argument("--themes", type=str, default=None, help="Comma-separated list of themes to scrape")
    parser.add_argument("--init", action="store_true", help="Clear old data and run a clean crawl")
    args = parser.parse_args()
    
    # Load config file values
    cfg_themes, cfg_scrolls = load_config()
    
    # Override with command line arguments if provided
    if args.themes is not None:
        args.themes_list = [{"name": t.strip(), "query": t.strip()} for t in args.themes.split(",") if t.strip()]
    else:
        args.themes_list = cfg_themes
        
    if args.scrolls is not None:
        args.scrolls_val = args.scrolls
    else:
        args.scrolls_val = cfg_scrolls
        
    asyncio.run(main_async(args))

if __name__ == "__main__":
    main()

