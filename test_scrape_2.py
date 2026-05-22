import asyncio
import re
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        print("Launching browser...")
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            locale="zh-TW",
            timezone_id="Asia/Taipei"
        )
        page = await context.new_page()
        
        url = "https://www.threads.net/search?q=taiwan"
        print(f"Navigating to {url}...")
        await page.goto(url, wait_until="networkidle")
        
        print("Waiting 15 seconds for everything to settle...")
        await page.wait_for_timeout(15000)
        
        # Take a screenshot before cleanup
        await page.screenshot(path="screenshot_before.png")
        print("Saved screenshot_before.png")

        # Let us see what elements are on the page
        # Get count of <article> elements
        articles_count = await page.locator("article").count()
        print(f"Number of <article> tags: {articles_count}")
        
        # Try to find user profile links to verify they exist
        links = await page.locator("a").all()
        user_links = []
        for link in links:
            href = await link.get_attribute("href")
            if href and "/@" in href:
                user_links.append(href)
        print(f"Found {len(user_links)} user links (e.g., {user_links[:5]})")
        
        # Try to remove the login modal
        # Usually, the modal is in a role="dialog" or a fixed overlay container
        try:
            # Let us see if we can find modal overlays and delete them
            deleted_modal = await page.evaluate("""() => {
                let dialogs = document.querySelectorAll('div[role="dialog"]');
                let count = dialogs.length;
                dialogs.forEach(el => el.remove());
                
                // Also remove dark overlays or scroll locks on body
                document.body.style.overflow = 'auto';
                document.body.style.setProperty('overflow', 'auto', 'important');
                
                // Look for fixed overlays that block interaction
                let fixed_divs = document.querySelectorAll('div');
                fixed_divs.forEach(div => {
                    let style = window.getComputedStyle(div);
                    if (style.position === 'fixed' && (style.zIndex > 10 || div.textContent.includes('使用 Instagram') || div.textContent.includes('Threads'))) {
                        div.remove();
                        count++;
                    }
                });
                return count;
            }""")
            print(f"Removed {deleted_modal} blocking modal/overlay elements.")
        except Exception as e:
            print("Failed to remove modal:", e)
            
        # Try scrolling now that modal is removed
        print("Attempting to scroll to load more posts...")
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        await page.wait_for_timeout(3000)
        
        # Count articles again after scroll
        articles_count_after = await page.locator("article").count()
        print(f"Number of <article> tags after scroll: {articles_count_after}")
        
        if articles_count_after > 0:
            articles = await page.locator("article").all()
            for idx, article in enumerate(articles[:3]):
                text = await article.text_content()
                print(f"\n--- Article {idx+1} ---")
                print(text[:300].strip())
                print("-" * 20)
                
        await page.screenshot(path="screenshot_after.png")
        print("Saved screenshot_after.png")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
