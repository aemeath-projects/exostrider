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
        // 类型
        { selector: 'typeParameter', format: ['PascalCase'] },
        { selector: 'class', format: ['PascalCase'] },
        { selector: 'interface', format: ['PascalCase'], custom: { regex: '^I[A-Z]', match: false } },
        { selector: 'typeAlias', format: ['PascalCase'] },
        { selector: 'enum', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['PascalCase'] },
        // 函数 / 方法（装饰器工厂函数允许 PascalCase）
        {
          selector: 'function',
          format: ['PascalCase'],
          filter: {
            regex:
              '^(Service|Inject|Provide|Startup|Shutdown|Handler|OnCommand|OnRegex|OnKeyword|OnStartsWith|OnEndsWith|OnFullMatch|OnEvent|OnNotice|OnRequest|OnMessageSent|OnPoke|OnEssence|OnOffline|Scope|Permission|Priority|Interceptor|SettingNode)$',
            match: true,
          },
        },
        { selector: 'function', format: ['camelCase'] },
        { selector: 'method', format: ['camelCase'] },
        { selector: 'method', modifiers: ['private'], format: ['camelCase'], leadingUnderscore: 'require' },
        // 框架内部（semi-public）方法允许 _ 前缀
        { selector: 'method', format: ['camelCase'], leadingUnderscore: 'allow' },
        { selector: 'method', modifiers: ['requiresQuotes'], format: null },
        { selector: 'accessor', format: ['camelCase'] },
        // ── 参数 ──
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
        // ── 变量 ──
        { selector: 'variable', format: ['camelCase'] },
        {
          selector: 'variable',
          modifiers: ['const'],
          format: ['camelCase', 'UPPER_CASE'],
        },
        // 枚举对象（如 Permission、MessageScope、TimeoutMode）以 PascalCase 命名，允许例外
        {
          selector: 'variable',
          modifiers: ['const'],
          format: ['PascalCase'],
          filter: { regex: '^(Permission|MessageScope|TimeoutMode)$', match: true },
        },
        // ── 属性 ──
        { selector: 'property', format: ['camelCase'] },
        { selector: 'property', modifiers: ['private'], format: ['camelCase'], leadingUnderscore: 'require' },
        { selector: 'property', modifiers: ['requiresQuotes'], format: null },
        // ── 对象字面量属性（放行 snake_case API 参数）──
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
