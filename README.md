# ListingView

跨平台电商商品详情预览工作台。前端使用 React + TypeScript + Vite，后端使用 Node.js + Express，商品信息和图片元数据保存到 SQLite，图片文件保存到独立数据目录。

## 功能

- 商品卡片网格、名称/编号搜索、新增、编辑、删除
- 支持设置 `ADMIN_PASSWORD` 管理员密码：设置后访客默认只能看到「预览」并可下载原图 ZIP，输入密码解锁后才显示新建、编辑、删除、上传与 AI 识图选项；本地未设置密码时默认直接开启编辑模式
- 通用素材与亚马逊/天猫平台专属素材
- 主图和详情图多图上传、拖拽排序、删除、懒加载、预览；上方「图片素材」作为公共素材库，通过「导入图片」或直接在下方「平台专属图片」中上传后，才会在预览界面与平台下载中生效（导入共用同一实体文件，不重复保存）
- 亚马逊详情图支持电脑版/手机版分别导入、上传、宫格编排和删除
- 右侧图片识别面板：可直接填写第三方 API URL、Key 和模型，选择已上传图片识别商品名称和标题并填入草稿（不会自动保存；商品编号和价格不由模型猜测）
- 亚马逊和天猫独立 React 模板与 CSS
- 平台按钮在上层，电脑/手机/下载按钮在平台按钮下方；默认电脑模式
- 未配置平台标题或价格时自动使用通用标题或通用价格
- 点击“保存商品”后，图片按商品编号和栏目顺序规则命名；通用素材使用“编号-主图/详情图-序号”，平台专属新素材增加“亚马逊/天猫”及设备名，导入的通用素材仍共用同一实体文件
- SQLite 参数化查询，上传文件名校验、MIME 校验、文件签名校验和大小限制
- Windows 本地开发脚本、Linux 启动脚本、Docker Compose 部署方案

## 目录

```text
client/                 React/Vite 前端
server/                 Express API、SQLite、上传文件服务
server/src/db.ts        SQLite 初始化与持久化
server/src/routes.ts    REST API
server/src/storage.ts   图片校验与文件存储
scripts/                Windows 启动脚本
deploy/                 Linux 启动脚本
Dockerfile              Linux 容器构建
docker-compose.yml      持久化数据卷部署
```

## 数据目录与 Git 忽略

本地默认数据目录为项目根目录下的 `data/`：`listing-view.sqlite` 保存商品和图片元数据，`uploads/` 保存上传图片，`vision-config.json`（可选）保存图片识别 API 配置。该目录、SQLite 文件、运行时环境文件和构建缓存均已加入 `.gitignore`；`.env.example` 模板会保留在 Git 中。请不要把真实 `.env`、含密钥的识图配置、商品数据库或上传图片提交到仓库。自定义 `DATA_DIR` 时，建议放在项目仓库之外，以免发布、清理或复制源码时误处理用户数据。

## 环境要求

- Node.js 22 LTS 或更新版本
- npm 10 或更新版本
- Linux 部署可使用 Docker；不使用 Docker 时需要 Node.js 和 npm
- SQLite 使用 `sql.js`，不依赖 Windows Visual Studio、原生 C++ 编译链或平台专属 SQLite DLL

## Windows 本地开发

在 PowerShell 中执行：

```powershell
cd <项目目录>
npm.cmd run install:all
Copy-Item server/.env.example server/.env
Copy-Item client/.env.example client/.env
npm.cmd run dev
```

前端默认地址：`http://localhost:5173`。API 默认地址：`http://localhost:4000`。

也可以生成桌面上的“ListingView 启动”和“ListingView 关闭”两个快捷方式：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\create-windows-shortcuts.ps1
```

首次使用前先执行一次 `npm.cmd run install:all` 安装依赖。之后双击“ListingView 启动”启动前后端；双击“ListingView 关闭”停止本次启动的服务。快捷方式会调用项目脚本，项目移动后重新运行快捷方式生成脚本即可更新路径。关闭脚本只停止本次启动进程树；若启动记录与进程不匹配会拒绝操作，不会误停其他占用相同端口的程序。也可以直接在 PowerShell 中运行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-windows.ps1` 或 `stop-windows.ps1`。

## 配置

服务端配置放在 `server/.env`，参考 `server/.env.example`：

- `PORT`：API 或生产服务端口
- `DATA_DIR`：持久化数据目录，包含 SQLite 文件和 `uploads/`
- `CLIENT_DIST_DIR`：生产环境前端构建目录
- `MAX_FILE_SIZE_MB`：单张图片大小限制
- `CORS_ORIGIN`：开发环境前端来源；生产同源部署可设为服务端地址
- `ADMIN_PASSWORD`：可选，管理员编辑密码。部署到公网时建议填写；填写后访客只看到商品预览与下载按钮，后端新增/修改/删除商品、上传/删除/排序图片及视觉 API 配置接口均需要密码鉴权
- `VISION_API_BASE_URL`：可选，第三方 OpenAI 兼容 API 根地址（通常以 `/v1` 结尾，也可直接填写完整 `/chat/completions` 地址）
- `VISION_API_KEY`：可选，第三方 API 密钥，仅由服务端读取；无密钥的自托管服务可留空
- `VISION_MODEL`：支持图片输入的模型名称。可在编辑页面板配置，也可由环境变量提供；未配置时会显示提示
`DATA_DIR` 支持绝对路径；相对路径按 `server/` 目录解析。示例中的 `../data` 指向项目根目录的 `data/`。Windows 启动脚本会自动将数据目录设为项目根目录下的 `data/`；Linux 服务器建议配置仓库外的绝对路径，例如 `/srv/listing-view-data`。

当配置了 `ADMIN_PASSWORD` 时，商品新增/修改/删除、图片上传/导入/删除/排序以及图片识别 API 配置与调用接口都会启用服务端鉴权，访客仅可浏览商品预览和下载平台图片 ZIP。未配置 `ADMIN_PASSWORD` 时默认开放编辑，适合本地个人开发使用。
### 图片实体文件与命名规则

图片保存在 `DATA_DIR/uploads/<商品编号>/主图/` 和 `DATA_DIR/uploads/<商品编号>/详情图/`。上传时会先进入当前已保存编号对应的目录，使用安全的临时实体文件名；点击“保存商品”时，再根据当前编号（SKU）和图片在栏目中的顺序重命名。如果同时修改了编号，保存后也会迁移到新编号目录。编号为 `123` 时的示例：

```text
DATA_DIR/
├── listing-view.sqlite
└── uploads/
    └── 123/
        ├── 主图/
        │   ├── 123-主图-01.png
        │   ├── 123-主图-02.jpg
        │   ├── 123-亚马逊-主图-01.png
        │   └── 123-天猫-主图-01.png
        └── 详情图/
            ├── 123-详情图-01.webp
            ├── 123-亚马逊-详情图-01.png
            ├── 123-亚马逊-电脑-详情图-01.png
            ├── 123-亚马逊-手机-详情图-01.png
            └── 123-天猫-详情图-01.png
```

平台和设备通过文件名区分，放入对应的“主图”或“详情图”目录。同一商品、同一图片类型内，会按 SHA-256 校验文件内容：通用主图与亚马逊或天猫主图的文件内容完全相同时，即使分别上传、文件名不同或排列位置不同，也只保存一份实体文件。只要仍有通用引用，就优先使用通用文件名（如 `123-主图-01.jpg`），不会额外生成相同内容的 `123-亚马逊-主图-01.jpg`；详情图同样适用。每个栏目保留独立的图片记录、顺序与排版。已有重复文件会在下次保存所属商品时合并。此规则只合并文件字节完全相同的图片，重新压缩、裁剪或修改过的图片会分别保留；不同商品之间，以及主图和详情图之间，保持独立存储。“导入图片”只在数据库中增加对通用实体文件的引用，不复制图片文件；各栏目仍可独立排序和排版。只有最后一个引用被删除时，才删除实体文件，并清理空目录。

旧版直接放在 `uploads/` 下的图片仍可读取，下次保存所属商品时会自动迁移。数据库只保存使用 `/` 分隔的相对路径，实际文件操作统一通过 Node.js `path` 解析，兼容 Windows 和 Linux。文件扩展名保持原格式；编号中的文件名非法字符会替换为 `-`，Windows 保留名称（如 `CON`）和以点开头的目录名会加 `_` 前缀，无法使用或过长的编号会提示修改。不同商品的编号如果仅大小写不同，或清理后生成相同目录，将拒绝保存，避免跨平台目录冲突。发现未知同名文件时会报错，不会覆盖该文件。

备份必须递归包含整个 `uploads/` 目录及所有商品子目录；下方的 ZIP 和 tar 示例已包含这些子目录。

### 按平台下载图片 ZIP

在商品预览上方，每个平台下方依次显示“电脑 / 手机 / 下载”。点击“下载”，会生成当前商品的 `123-亚马逊.zip` 或 `123-天猫.zip`，内部只有“主图”和“详情图”两个分类目录：

```text
123-亚马逊.zip
├── 主图/
│   ├── 123-主图-01.png
│   └── 123-亚马逊-主图-01.jpg
└── 详情图/
    ├── 123-亚马逊-电脑-详情图-01.png
    └── 123-亚马逊-手机-详情图-01.png
```

- 主图及详情图都遵循预览相同的素材回退规则。亚马逊下载包合并电脑与手机实际使用的详情图，与当前选中的预览设备无关；两端都未用到的回退素材不会导出。天猫使用其专属素材，未配置时使用通用素材。
- 同一实体文件在同一分类中只打包一次；例如导入通用主图后，仍以通用文件名导出。电脑和手机共用的详情图同样只放一份。主图和详情图作为不同分类各自保留。
- 包内按各组的素材顺序使用规则名称；平台新上传的素材带“亚马逊/天猫”，设备专属详情图带“电脑/手机”。ZIP 名称和图片名称使用已保存的商品编号，下载不会保存或改动编辑草稿、数据库或原图文件。
- 原图使用 ZIP STORE 方式直接封装，不重新编码、不缩放、不转换格式，解压后文件字节、画质及尺寸均保持一致。图片本身已经压缩，ZIP 大小通常接近素材总大小。
- 后端逐个文件流式输出，不在服务器上生成临时 ZIP，也不需要 WinRAR、7-Zip 等外部软件。最多同时执行 2 个打包任务，超出时提示稍后重试；取消或中断下载会释放任务。浏览器接收完整 ZIP 后再保存，大包仍会占用浏览器内存或临时存储及下载磁盘空间。
- 没有素材或文件缺失时显示错误提示。打包期间如素材文件被移动、删除或替换，下载可能失败，请在素材调整完成后重试。此下载包仅包含图片，不包含 SQLite、排版元数据或识图配置，完整备份仍需按下方说明执行。

接口为 `GET /api/products/:id/export?platform=amazon|tmall`，返回 `application/zip` 附件。Windows 本地、Linux 直接部署及 Docker 均使用同一套 Node.js 实现，无需新增系统工具或环境变量。

可在编辑页右侧“图片识别填资料”面板填写 API URL、API Key 和支持图片输入的模型，保存后立即生效，无需重启。设置写入 `DATA_DIR/vision-config.json`，密钥仅保存在服务端，Linux 下尽力限制为仅服务进程用户可读；接口状态不会返回密钥。留空 Key 可保持已有密钥。点击“恢复服务端环境变量”可删除面板配置并恢复环境变量设置。也可继续使用 `VISION_API_BASE_URL`、`VISION_API_KEY` 和 `VISION_MODEL` 环境变量。识图时，用户选中的 1–3 张 JPG/PNG/WEBP 图片会由服务端从当前商品的上传目录读取，并随请求发送给配置的第三方视觉服务。图片不会以 Base64 形式存储在本系统或写入数据库；发送给视觉 API 时会按 OpenAI 兼容接口协议临时编码在请求体中，请先确认服务商的数据处理政策和费用。模型只建议名称与标题，商品编号和价格保持不变。识别内容可能不准确，填入后请人工核对并点击“保存商品”。

前端开发代理配置在 `client/vite.config.ts`，可以通过 `VITE_API_PROXY_TARGET` 指向不同 API 地址。生产构建可通过 `VITE_API_BASE_URL` 配置 API 前缀。

## Linux 部署

### 直接使用 Node.js

```sh
cp server/.env.example server/.env
# 编辑 server/.env，至少设置 NODE_ENV=production、PORT、DATA_DIR、CLIENT_DIST_DIR、CORS_ORIGIN
sh deploy/start-linux.sh
```

建议把 `DATA_DIR` 设置到发布目录之外，例如 `/srv/listing-view-data`，这样更新代码或替换发布目录不会覆盖商品和图片。运行用户必须对该目录拥有读写权限：

```sh
sudo install -d -o listingview -g listingview -m 750 /srv/listing-view-data/uploads
```

### Docker Compose

```sh
cp .env.example .env 2>/dev/null || true
mkdir -p data/uploads
chmod 750 data data/uploads
docker compose up -d --build
```

Compose 使用名为 `listing-view-data` 的持久化卷挂载到 `/data`。应用重启、镜像更新或容器替换后，商品数据库和图片仍保留。

如需绑定服务器目录，可把 compose 中的 `listing-view-data:/data` 替换为 `/srv/listing-view-data:/data`，并确保容器用户对目录有读写权限。

## 备份与恢复

备份时同时保存 SQLite 数据库、`uploads/` 图片目录和可选的 `vision-config.json`，避免只备份数据库导致图片元数据失效。为保证数据库与图片对应一致，**备份和恢复前先停止服务**。`vision-config.json` 可能含有第三方 API Key，应将备份作为密钥文件妥善保管。

### Windows 本地备份

在项目根目录的 PowerShell 中执行。先双击“ListingView 关闭”快捷方式（或在运行服务的终端按 `Ctrl+C`），然后备份默认 `data/` 目录：

```powershell
$dataDir = (Resolve-Path .\data).Path
$backupFile = Join-Path $HOME ("ListingView-backup-{0}.zip" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
Compress-Archive -Path (Join-Path $dataDir '*') -DestinationPath $backupFile
Write-Host "备份已保存到：$backupFile"
```

如使用自定义 `DATA_DIR`，请将 `$dataDir` 改为该目录。恢复时先停止服务并备份当前数据，再把 ZIP 解压到临时目录，将其中的 `listing-view.sqlite`、`uploads/` 及需要的 `vision-config.json` 放回 `DATA_DIR` 对应位置；确认文件齐全后再启动服务。

### Linux 直接部署备份与恢复

以下示例假设服务由 `systemd` 管理，数据目录为 `/srv/listing-view-data`。如服务名称或路径不同，请相应替换。备份包含数据库、全部图片和存在时的识图配置：

```sh
DATA_DIR=/srv/listing-view-data
BACKUP_DIR=/srv/backups
sudo systemctl stop listing-view
mkdir -p "$BACKUP_DIR"
backup_file="$BACKUP_DIR/listing-view-$(date +%Y%m%d-%H%M%S).tar.gz"
set -- listing-view.sqlite uploads
[ ! -f "$DATA_DIR/vision-config.json" ] || set -- "$@" vision-config.json
sudo tar -C "$DATA_DIR" -czf "$backup_file" "$@"
sudo systemctl start listing-view
echo "备份已保存到：$backup_file"
```

恢复前先停止服务，并在覆盖前备份当前数据。将 `BACKUP_FILE` 设置为要恢复的归档路径：

```sh
DATA_DIR=/srv/listing-view-data
BACKUP_FILE=/srv/backups/listing-view-YYYYMMDD-HHMMSS.tar.gz
sudo systemctl stop listing-view
sudo tar -C "$DATA_DIR" -xzf "$BACKUP_FILE"
sudo chown -R listingview:listingview "$DATA_DIR"
sudo systemctl start listing-view
```

Docker Compose 部署时，先执行 `docker compose stop listing-view`，再备份绑定目录或使用 Docker 卷备份工具备份 `listing-view-data` 卷；恢复后再执行 `docker compose start listing-view`。不要运行 `docker compose down -v`，因为 `-v` 会删除 Compose 管理的数据卷。生产环境建议定期将备份复制到另一块磁盘或对象存储；不要把 `server/.env`、根目录 `.env`、`vision-config.json`、API 密钥或服务器配置提交到 Git。Docker Compose 部署时可将识图环境变量写入根目录 `.env`；直接运行 Node.js 时配置 `server/.env`。

## 验证命令

```sh
npm run typecheck
npm run build
npm test
```

`npm test` 会在临时数据目录启动服务，验证平台 ZIP 的文件夹、中文文件名、素材回退、电脑/手机合并、去重、解压后字节一致、并发限制及取消释放，以及商品增删改查、图片上传、平台与设备素材回退、宫格排序、识图接口，以及编号/类型分目录、规则命名、共用文件、排序后的文件名互换、冲突保护、保存失败回滚、旧图片迁移和重启读取。测试结束会清理临时数据，不会修改正式 `data/` 目录。

生产构建验证可在先完成前端和后端构建后执行。该测试使用临时数据启动 `server/dist/index.js`，同时验证前端页面及构建资源可访问：

```powershell
# Windows PowerShell，项目根目录
npm.cmd --prefix server run build
$env:TEST_BUILT_SERVER = '1'
$env:NODE_ENV = 'production'
try { npm.cmd test } finally {
  Remove-Item Env:TEST_BUILT_SERVER -ErrorAction SilentlyContinue
  Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
}
```

```sh
# Linux，项目根目录（先运行 npm run build）
npm --prefix server run build
NODE_ENV=production TEST_BUILT_SERVER=1 npm test
```
