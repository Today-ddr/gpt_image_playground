#!/bin/sh
set -eu

if ! command -v docker >/dev/null 2>&1; then
  echo '未找到 Docker，请先安装并启动 Docker Desktop。' >&2
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

mkdir -p data/jobs
docker compose up -d --build

published_address=$(docker compose port web 80)
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
    echo "等待后台任务服务就绪超时，请运行：docker compose logs --tail=200" >&2
    exit 1
  fi
  sleep 1
done

echo "已启动：http://localhost:${app_port}"
echo '查看日志：docker compose logs -f'
echo '停止服务：docker compose down'
