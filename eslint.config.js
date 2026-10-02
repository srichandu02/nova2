/* ESLint flat config (optional: `npx eslint .`). The project itself has no runtime or build dependencies. */
const browser = {
  window: "readonly", document: "readonly", navigator: "readonly", location: "readonly", localStorage: "readonly",
  globalThis: "readonly", self: "readonly", caches: "readonly", fetch: "readonly", setTimeout: "readonly", clearTimeout: "readonly",
  console: "readonly", URL: "readonly", Date: "readonly"
};
const node = { require: "readonly", module: "writable", __dirname: "readonly", process: "readonly" };

module.exports = [
  {
    files: ["**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "script", globals: { ...browser, ...node } },
    rules: {
      "no-unused-vars": "error", "no-undef": "error", eqeqeq: "error", "no-var": "error", "prefer-const": "error",
      "no-eval": "error", "no-implied-eval": "error", "no-new-func": "error", curly: ["error", "multi-line"], "max-len": ["warn", 160]
    }
  }
];
