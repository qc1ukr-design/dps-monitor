/** @type {import('jest').Config} */
module.exports = {
  // ts-jest компілює TypeScript без окремого tsc-кроку
  preset: 'ts-jest',

  // Node environment — не потрібен jsdom для backend-тестів
  testEnvironment: 'node',

  // Шукаємо тести тільки у src/tests, щоб не підхоплювати dist/
  roots: ['<rootDir>/src/tests'],

  // Резолвимо .js extension-суфікси, які TypeScript source-файли використовують
  // в import-рядках (наприклад: '../lib/kmsClient.js' → '../lib/kmsClient')
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },

  // Налаштування ts-jest: використовуємо tsconfig.scripts.json
  // (CommonJS module resolution — сумісний з Jest)
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.scripts.json',
      },
    ],
  },

  // 10 секунд на тест — достатньо з урахуванням async mock-вик ликів
  testTimeout: 10000,

  // Зрозуміліший вивід при запуску в CI
  verbose: true,
}
