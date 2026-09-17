// 把库内文章目录映射成 wxfile:// 基地址,供阅读器与书架封面读本地资源。
// dir 在 libraryRoot 之下时取相对子路径、逐段编码;否则(用户改过库根)回退原 dir,
// wxfile 协议会 403,对应资源不显示——这是预期的降级而非崩溃。
// Windows 上分隔符混用(库根 `\`、dir `/` 或反之),故两侧统一成 `/` 后再比前缀。
export function toWxfileBase(libraryRoot: string, dir: string): string {
  const norm = (s: string) => s.replace(/[/\\]+$/, '').replace(/\\/g, '/')
  const root = norm(libraryRoot)
  const full = norm(dir)
  // 库根本身 → 空相对路径;Windows 比对不区分大小写
  let rel = full.toLowerCase() === root.toLowerCase() ? ''
    : full.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? full.slice(root.length + 1) : dir
  rel = rel.replace(/^[/\\]+/, '').split(/[/\\]/).map(encodeURIComponent).join('/')
  return `wxfile://local/${rel}`
}

export function wxfileJoin(base: string, file: string): string {
  return `${base}/${file.split('/').map(encodeURIComponent).join('/')}`
}
