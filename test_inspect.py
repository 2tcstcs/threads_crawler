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
        
        # Run JS to inspect the elements containing post links
        info = await page.evaluate("""() => {
            let links = Array.from(document.querySelectorAll('a[href*="/post/"]'));
            let results = [];
            
            links.slice(0, 3).forEach((link, idx) => {
                let current = link;
                let path = [];
                // Traverse up 5 parents
                for (let i = 0; i < 6; i++) {
                    if (current) {
                        path.push({
                            tagName: current.tagName,
                            className: current.className,
                            id: current.id,
                            role: current.getAttribute('role')
                        });
                        current = current.parentElement;
                    }
                }
                results.push({
                    linkText: link.textContent,
                    href: link.getAttribute('href'),
                    path: path
                });
            });
            return results;
        }""")
        
        print("DOM Traversal from post links:")
        for idx, item in enumerate(info):
            print(f"\nLink {idx+1}: {item['linkText']} ({item['href']})")
            for depth, parent in enumerate(item['path']):
                print(f"  Parent {depth}: <{parent['tagName'].lower()} class='{parent['className']}' role='{parent['role']}'>")
                
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
