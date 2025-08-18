import {readFile, writeFile} from 'fs';

import codeSnippet from './index.js';
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt()
    .use(codeSnippet)

readFile('./test.md', 'utf8', (err, data) => {
    if (err) throw err;
    const result = md.render(data);
    writeFile('./test.html', result, (err) => {
        if (err) throw err;
    });
})