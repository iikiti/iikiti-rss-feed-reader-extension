import fs from 'fs';
import path from 'path';
import glob from 'tiny-glob';

async function extractInlineScripts() {
    const htmlFiles = await glob('build/**/*.html');
    
    for (const file of htmlFiles) {
        let content = fs.readFileSync(file, 'utf-8');
        const scriptRegex = /<script>([\s\S]*?)<\/script>/gi;
        let match;
        let scriptIndex = 0;
        
        while ((match = scriptRegex.exec(content)) !== null) {
            let scriptContent = match[1];
            
            // Remove the inline script from the HTML
            const scriptName = `${path.basename(file, '.html')}-inline-${scriptIndex++}.js`;
            const scriptPath = path.join(path.dirname(file), scriptName);
            
            // Write the external script
            fs.writeFileSync(scriptPath, scriptContent);
            
            // Replace the inline script with an external reference
            content = content.replace(match[0], `<script src="./${scriptName}"></script>`);
        }
        
        // Remove CSP meta tag added by SvelteKit to allow standard extension CSP to work
        content = content.replace(/<meta http-equiv="content-security-policy"[^>]*>/i, '');
        
        fs.writeFileSync(file, content);
    }
    console.log('Successfully extracted inline scripts.');
}

extractInlineScripts().catch(console.error);
