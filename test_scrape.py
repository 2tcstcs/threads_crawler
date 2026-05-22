import asyncio
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
        
        print("Waiting for article elements...")
        try:
            await page.wait_for_selector("article", timeout=10000)
            print("Found article(s)!")
        except Exception as e:
            print("Timeout waiting for articles:", e)
            # Save screenshot to see what is on the page
            await page.screenshot(path="screenshot.png")
            print("Saved screenshot.png")
            await browser.close()
            return
            
        articles = await page.locator("article").all()
        print(f"Total articles found on page: {len(articles)}")
        
        if len(articles) > 0:
            first_article = articles[0]
            text = await first_article.text_content()
            html = await first_article.outer_html()
            
            print("\n=== First Article Text Content ===")
            print(text)
            print("==================================\n")
            
            # Save outer HTML to inspect
            with open("article_sample.html", "w", encoding="utf-8") as f:
                f.write(html)
            print("Saved first article HTML to article_sample.html")
            
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
