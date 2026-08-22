const fs = require('fs');
const ts = require('typescript');
const path = 'server/routes.ts';
const src = fs.readFileSync(path, 'utf8');
const sf = ts.createSourceFile(path, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const errs = sf.parseDiagnostics;
console.log(JSON.stringify(errs.map(e => ({
  line: e.start + 1,
  length: e.length,
  message: ts.flattenDiagnosticMessageText(e.messageText, '\n')
})), null, 2));
