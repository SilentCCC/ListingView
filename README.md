# ListingView

跨平台电商商品详情预览工作台。前端使用 React + TypeScript + Vite，后端使用 Node.js + Express，商品信息和图片元数据保存到 SQLite，图片文件保存到独立数据目录。

## 功能

- 商品卡片网格、名称/编号搜索、新增、编辑、删除
- 通用素材与亚马逊/天猫平台专属素材
- 主图和详情图多图上传、拖拽排序、删除、懒加载、预览
- 亚马逊详情图支持电脑版/手机版分别上传、排序和删除；未配置专属图时自动回退到亚马逊通用详情图（旧图片迁移为通用素材）
- 右侧图片识别面板：可直接填写第三方 API URL、Key 和模型，选择已上传图片识别商品名称和标题并填入草稿（不会自动保存；商品编号和价格不由模型猜测）
- 亚马逊和天猫独立 React 模板与 CSS
- 平台按钮在上层，电脑/手机按钮在平台按钮下方；默认电脑模式
- 未配置平台标题、价格或图片时自动使用通用内容
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
npm run install:all
Copy-Item server/.env.example server/.env
Copy-Item client/.env.example client/.env
npm run dev
```

前端默认地址：`http://localhost:5173`。API 默认地址：`http://localhost:4000`。

也可以生成桌面上的“ListingView 启动”和“ListingView 关闭”两个快捷方式：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\create-windows-shortcuts.ps1
```

首次使用前先执行一次 `npm run install:all` 安装依赖。之后双击“ListingView 启动”启动前后端；双击“ListingView 关闭”停止本次启动的服务。快捷方式会调用项目脚本，项目移动后重新运行快捷方式生成脚本即可更新路径。关闭脚本只停止本次启动进程树；若启动记录与进程不匹配会拒绝操作，不会误停其他占用相同端口的程序。也可以直接在 PowerShell 中运行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-windows.ps1` 或 `stop-windows.ps1`。

## 配置

服务端配置放在 `server/.env`，参考 `server/.env.example`：

- `PORT`：API 或生产服务端口
- `DATA_DIR`：持久化数据目录，包含 SQLite 文件和 `uploads/`
- `CLIENT_DIST_DIR`：生产环境前端构建目录
- `MAX_FILE_SIZE_MB`：单张图片大小限制
- `CORS_ORIGIN`：开发环境前端来源；生产同源部署可设为服务端地址
- `VISION_API_BASE_URL`：可选，第三方 OpenAI 兼容 API 根地址（通常以 `/v1` 结尾，也可直接填写完整 `/chat/completions` 地址）
- `VISION_API_KEY`：可选，第三方 API 密钥，仅由服务端读取；无密钥的自托管服务可留空
- `VISION_MODEL`：支持图片输入的模型名称。可在编辑页面板配置，也可由环境变量提供；未配置时会显示提示
`DATA_DIR` 支持绝对路径；相对路径按 `server/` 目录解析。示例中的 `../data` 指向项目根目录的 `data/`。Windows 启动脚本会自动将数据目录设为项目根目录下的 `data/`；Linux 服务器建议配置仓库外的绝对路径，例如 `/srv/listing-view-data`。

编辑页的 API 配置接口没有登录认证，适用于仅本人/可信网络可访问的本地工具；若部署到公网，必须在反向代理或网络层增加访问控制，不要直接暴露配置接口。

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

`npm test` 会在临时数据目录启动服务并验证健康检查、商品列表、新增、编辑、PNG 上传和删除流程。测试结束会清理临时数据，不会修改正式 `data/` 目录。

