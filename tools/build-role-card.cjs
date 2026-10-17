// Rebuild from this project's dependencies; no external maintenance workspace.
const path=require('node:path'),fs=require('node:fs');
const project=path.resolve(__dirname,'..'),deps=path.join(project,'frontend','node_modules');
for(const name of ['esbuild','three'])if(!fs.existsSync(path.join(deps,name,'package.json')))throw Error(`缺少 ${name}。先在项目 frontend 目录运行 npm ci --ignore-scripts。`);
require(path.join(deps,'esbuild')).buildSync({
 entryPoints:[path.join(project,'web/assets/experience/role-card/viewer-source.js')],
 outfile:path.join(project,'web/assets/experience/role-card/viewer.js'),
 bundle:true,minify:true,format:'esm',nodePaths:[deps],logLevel:'info',
});
