import eslint from '@eslint/js'
import { defineConfig } from 'eslint/config'
import prettier from 'eslint-config-prettier'
import importPlugin from 'eslint-plugin-import-x'
import tseslint from 'typescript-eslint'

export default defineConfig(
  { ignores: ['dist/', 'node_modules/', '**/*.js', '**/*.cjs', '**/*.mjs'] },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: 'tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    plugins: { 'import-x': importPlugin },
    rules: {
      'import-x/order': ['error', {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        'newlines-between': 'always',
        alphabetize: { order: 'asc' },
      }],
      'import-x/no-duplicates': 'error',
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    rules: {
      '@typescript-eslint/naming-convention': [
        'error',
        // 类型声明
        { selector: 'typeParameter', format: ['PascalCase'] },
        { selector: 'class', format: ['PascalCase'] },
        { selector: 'interface', format: ['PascalCase'], custom: { regex: '^I[A-Z]', match: false } },
        { selector: 'typeAlias', format: ['PascalCase'] },
        { selector: 'enum', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['UPPER_CASE'] },
        // 函数
        // 装饰器工厂函数惯例为 PascalCase
        { selector: 'function', format: ['camelCase', 'PascalCase'] },
        // 方法
        { selector: 'method', format: ['camelCase'] },
        { selector: 'method', modifiers: ['requiresQuotes'], format: null },
        { selector: 'method', modifiers: ['private'], format: ['camelCase'], leadingUnderscore: 'allow' },
        { selector: 'accessor', format: ['camelCase'] },
        // 参数
        // 允许 _ 前缀标记未使用参数
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
        // 变量
        { selector: 'variable', format: ['camelCase'] },
        // const：camelCase（局部）| UPPER_CASE（模块常量）| PascalCase（as const 对象）
        { selector: 'variable', modifiers: ['const'], format: ['camelCase', 'UPPER_CASE', 'PascalCase'] },
        // 属性
        { selector: 'property', format: ['camelCase'] },
        { selector: 'property', modifiers: ['requiresQuotes'], format: null },
        { selector: 'property', modifiers: ['private'], format: ['camelCase'], leadingUnderscore: 'allow' },
        // 对象字面量属性不限制
        // 兼容第三方 snake_case API
        { selector: 'objectLiteralProperty', format: null },
      ],
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/consistent-generic-constructors': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'variable', modifiers: ['destructured'], format: null },
      ],
    },
  },
  prettier,
)
