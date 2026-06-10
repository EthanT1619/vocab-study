const fs = require('fs');
const path = require('path');

const base = __dirname;
const html = fs.readFileSync(path.join(base, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(base, 'css', 'style.css'), 'utf8');
const js = fs.readFileSync(path.join(base, 'js', 'app.js'), 'utf8');

let out = html
  .replace('<link rel="stylesheet" href="css/style.css">', `<style>\n${css}\n</style>`)
  .replace('<script src="js/app.js"></script>', `<script>\n${js}\n</script>`);

fs.writeFileSync(path.join(base, 'standalone-bundled.html'), out, 'utf8');
console.log('standalone-bundled.html created:', out.length, 'bytes');
