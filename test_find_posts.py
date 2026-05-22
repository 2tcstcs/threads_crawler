import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        print("Launching browser...")
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        url = "https://www.threads.com/search?q=taiwan"
        print(f"Navigating to {url}...")
        await page.goto(url, wait_until="networkidle")
        await page.wait_for_timeout(5000)
        
        # We will run js to find the main container of the posts
        info = await page.evaluate("""() => {
            // Find all links containing '/post/'
            let postLinks = Array.from(document.querySelectorAll('a[href*="/post/"]'));
            
            // Filter unique post hrefs to avoid duplicates within the same post
            let uniqueHrefs = [];
            let uniqueLinks = [];
            postLinks.forEach(link => {
                let href = link.getAttribute('href');
                if (href && !uniqueHrefs.includes(href)) {
                    uniqueHrefs.push(href);
                    uniqueLinks.push(link);
                }
            });
            
            // For each unique post link, find its parent hierarchy up to 15 levels
            // We want to find a common ancestor level where the posts are siblings.
            let results = [];
            uniqueLinks.slice(0, 4).forEach((link, idx) => {
                let current = link;
                let ancestors = [];
                while (current && ancestors.length < 15) {
                    ancestors.push({
                        tagName: current.tagName,
                        className: current.className,
                        textSummary: current.textContent ? current.textContent.substring(0, 60).replace(/\\s+/g, ' ') : ''
                    });
                    current = current.parentElement;
                }
                results.push({
                    href: link.getAttribute('href'),
                    ancestors: ancestors
                });
            });
            return results;
        }""")
        
        print("Ancestors for posts:")
        for idx, item in enumerate(info):
            print(f"\n--- Post {idx+1} ({item['href']}) ---")
            for depth, ancestor in enumerate(item['ancestors']):
                print(f"  Parent {depth}: <{ancestor['tagName'].lower()} class='{ancestor['className']}'> -> text: {ancestor['textSummary']}")
                
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
