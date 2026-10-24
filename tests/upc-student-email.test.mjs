import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/studentEmail.ts', import.meta.url), 'utf8')
  .replaceAll('export ', '');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const context = {};
vm.createContext(context);
vm.runInContext(compiled, context);
const validate = context.validateStudentEmail;

test('student email validation accepts exact domain and preserves aliases', () => {
  for (const email of [
    '20260001@s.upc.edu.cn',
    'student.name+lab@s.upc.edu.cn',
    'Student.Name@s.upc.Edu.Cn',
  ]) {
    const result = validate(email);
    assert.equal(result.ok, true, email);
    assert.equal(result.email, email.trim());
  }
});

test('student email validation rejects other domains, subdomains and malformed aliases', () => {
  for (const email of [
    '', 'student@upc.edu.cn', 'student@qq.com', 'student@gmail.com',
    'student@s.upc.edu.cn.evil.test', 'student@sub.s.upc.edu.cn',
    'student@@s.upc.edu.cn', 'student@ s.upc.edu.cn', '.student@s.upc.edu.cn',
    'student..name@s.upc.edu.cn',
  ]) {
    assert.equal(validate(email).ok, false, email);
  }
});
