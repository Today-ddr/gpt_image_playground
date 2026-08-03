#!/bin/sh
# 512MB 等低内存服务器：只 pull 预构建镜像并启动，绝不在本机 docker build。
set -eu

if ! command -v docker >/dev/null 2>&1; then
  echo '未找到 Docker，请先安装 Docker。' >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo '当前 Docker 不支持 Compose，请安装 Docker Compose。' >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo '未找到 curl，无法执行启动健康检查。' >&2
  exit 1
fi

# 可用环境变量覆盖；默认对应当前仓库 owner 小写
: "${GHCR_OWNER:=today-ddr}"
: "${IMAGE_TAG:=latest}"
export GHCR_OWNER IMAGE_TAG

compose_file=compose.prod.yaml
if [ ! -f "$compose_file" ]; then
  echo "缺少 ${compose_file}，请先 git pull 最新代码。" >&2
  exit 1
fi

mkdir -p data/jobs

echo "拉取镜像 ghcr.io/${GHCR_OWNER}/gpt_image_playground:${IMAGE_TAG} ..."
echo "拉取镜像 ghcr.io/${GHCR_OWNER}/gpt_image_playground-job-api:${IMAGE_TAG} ..."
if ! docker compose -f "$compose_file" pull; then
  echo '' >&2
  echo '拉取失败。若仓库/Package 是私有的，请先登录 GHCR：' >&2
  echo '  # 在 GitHub → Settings → Developer settings → Personal access tokens' >&2
  echo '  # 勾选 read:packages（私有包还要 repo）' >&2
  echo '  echo YOUR_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin' >&2
  echo '' >&2
  echo '并确认 GitHub Actions 已成功构建镜像（Actions → Build and Publish Docker Image）。' >&2
  exit 1
fi

docker compose -f "$compose_file" up -d --remove-orphans

published_address=$(docker compose -f "$compose_file" port web 80)
app_port=${published_address##*:}
if [ -z "$app_port" ] || [ "$app_port" = "$published_address" ]; then
  echo '无法读取 web 容器的宿主机端口映射。' >&2
  exit 1
fi

health_url="http://127.0.0.1:${app_port}/api/jobs/health"
attempt=0
until curl -fsS "$health_url" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    echo "等待后台任务服务就绪超时，请运行：docker compose -f ${compose_file} logs --tail=200" >&2
    exit 1
  fi
  sleep 1
done

echo "已启动（预构建镜像，无本机编译）：http://localhost:${app_port}"
echo "镜像标签：${IMAGE_TAG}  owner：${GHCR_OWNER}"
echo "查看日志：docker compose -f ${compose_file} logs -f"
echo "停止服务：docker compose -f ${compose_file} down"
echo "更新版本：git pull && IMAGE_TAG=latest ./start.prod.sh"
