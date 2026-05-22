import asyncio
import re
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        print("Launching browser...")
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        url = "https://www.threads.com/search?q=AI"
        print(f"Navigating to {url}...")
        await page.goto(url, wait_until="networkidle")
        await page.wait_for_timeout(5000)
        
        # Extract posts using JS
        posts = await page.evaluate("""() => {
            let postLinks = Array.from(document.querySelectorAll('a[href*="/post/"]'));
            
            // Unique hrefs
            let uniqueHrefs = [];
            let uniqueLinks = [];
            postLinks.forEach(link => {
                let href = link.getAttribute('href');
                if (href && !uniqueHrefs.includes(href)) {
                    uniqueHrefs.push(href);
                    uniqueLinks.push(link);
                }
            });
            
            let data = [];
            
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
                
                // Now extract details from postContainer
                let textContent = postContainer.textContent || '';
                
                // Get all links in the container
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
                    // Try to guess from post link
                    let postHref = link.getAttribute('href');
                    let match = postHref.match(/\/@([^/]+)\/post\//);
                    if (match) {
                        username = match[1];
                        user_url = 'https://www.threads.com/@' + username;
                    }
                }
                
                // Post text: try to find elements with dir="auto"
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
                
                // Likes and Replies count
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
                
                data.push({
                    id: postId,
                    username: username,
                    user_url: user_url,
                    text: post_text || '無內文',
                    url: 'https://www.threads.com' + href,
                    likes: likes,
                    replies: replies,
                    time_str: link.textContent.trim(),
                    raw_text: textContent
                });
            });
            return data;
        }""")
        
        print(f"Extracted {len(posts)} posts:")
        for idx, post in enumerate(posts[:5]):
            print(f"\n--- Post {idx+1} ---")
            print(f"ID: {post['id']}")
            print(f"Username: {post['username']}")
            print(f"User URL: {post['user_url']}")
            print(f"Post URL: {post['url']}")
            print(f"Time string: {post['time_str']}")
            print(f"Likes: {post['likes']}")
            print(f"Replies: {post['replies']}")
            print(f"Text: {post['text']}")
            # print(f"Raw Text: {post['raw_text']}")
            print("-" * 20)
            
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
