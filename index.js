// KataBump / Pterodactyl 部署引导入口
// Startup Command 固定为 `node /home/container/<JS file>`，且项目是 TypeScript，
// 这里先注册 tsx 的 CJS loader（使 require() 能加载 .ts，包括 plugins/*/index.ts），
// 再加载主程序 src/index.ts。
require('tsx/cjs');
require('./src/index.ts');
