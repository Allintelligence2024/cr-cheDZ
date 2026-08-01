/** Prettier partagé */
export default {
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  tabWidth: 2,
  overrides: [
    { files: '*.md', options: { proseWrap: 'always' } },
    { files: '*.sql', options: { tabWidth: 2 } },
  ],
};
