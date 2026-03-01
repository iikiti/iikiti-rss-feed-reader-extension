import fs from 'fs';
import path from 'path';
import glob from 'tiny-glob';

async function extractInlineScripts() {
    const htmlFiles = await glob('build/**/*.html');
    
    for (const file of htmlFiles) {
        let content = fs.readFileSync(file, 'utf-8');
        const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
        let match;
        let scriptIndex = 0;
        
        while ((match = scriptRegex.exec(content)) !== null) {
            let scriptContent = match[1];
            const fullMatch = match[0];
            const openTagMatch = fullMatch.match(/<script\b([^>]*)>/i);
            const openTagAttrs = openTagMatch ? openTagMatch[1] : '';
            
            let attributes = '';
            if (openTagAttrs.includes('type="module"')) {
                attributes = ' type="module"';
            }

            // Remove the inline script from the HTML
            const scriptName = `${path.basename(file, '.html')}-inline-${scriptIndex++}.js`;
            const scriptPath = path.join(path.dirname(file), scriptName);
            
            // Write the external script
            fs.writeFileSync(scriptPath, scriptContent);
            
            // Replace the inline script with an external reference
            content = content.replace(fullMatch, `<script src="./${scriptName}"${attributes}></script>`);
        }
        
        // Remove CSP meta tag added by SvelteKit to allow standard extension CSP to work
        content = content.replace(/<meta http-equiv="content-security-policy"[^>]*>/i, '');
        
        fs.writeFileSync(file, content);
    }
    console.log('Successfully extracted inline scripts.');
}

extractInlineScripts().catch(console.error);
