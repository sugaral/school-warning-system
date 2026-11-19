module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'prettier'],
  ignorePatterns: ['dist', 'node_modules', '*.js', '*.cjs', '*.mjs'],
  rules: {
    'no-undef': 'off',
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
    'no-empty': 'off',
    'no-constant-condition': 'off',
    'no-irregular-whitespace': 'off',
    'no-useless-escape': 'off',
  },
};
