module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  parser: 'vue-eslint-parser',
  parserOptions: {
    parser: '@typescript-eslint/parser',
    ecmaVersion: 'latest',
    sourceType: 'module',
    extraFileExtensions: ['.vue'],
  },
  plugins: ['vue', '@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:vue/vue3-essential'],
  ignorePatterns: ['dist', 'node_modules'],
  rules: {
    'no-undef': 'off',
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
    'vue/no-unused-vars': 'off',
    'vue/multi-word-component-names': 'off',
    'no-empty': 'off',
    'no-constant-condition': 'off',
    'no-irregular-whitespace': 'off',
  },
};
