#!/bin/bash
# AI Papers Daily - 启动脚本

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

echo "🚀 AI Papers Daily 启动脚本"
echo "================================"

# 检查 Node.js
if ! command -v node &> /dev/null; then
  echo "❌ 未找到 Node.js，请先安装 Node.js 18+"
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Node.js 版本过低（当前: $(node -v)），需要 18+"
  exit 1
fi

echo "✅ Node.js $(node -v)"

# 检查 .env 文件
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example .env
    echo "⚠️  已从 .env.example 创建 .env，请编辑配置后重新运行"
    echo "   重要配置项："
    echo "   - MONGODB_URI: MongoDB 连接地址"
    echo "   - OPENAI_API_KEY: AI 摘要生成 API Key"
    exit 1
  else
    echo "❌ 未找到 .env 文件"
    exit 1
  fi
fi

echo "✅ 环境变量文件已就绪"

# 安装依赖
if [ ! -d "node_modules" ]; then
  echo "📦 安装依赖..."
  npm install
fi

echo "✅ 依赖已安装"

# 解析参数
MODE=${1:-"start"}

case "$MODE" in
  "start")
    echo ""
    echo "🌐 启动 Web 服务器..."
    echo "   访问地址: http://localhost:${PORT:-3000}"
    echo ""
    node backend/server.js
    ;;

  "dev")
    echo ""
    echo "🔧 开发模式启动..."
    if ! command -v nodemon &> /dev/null; then
      npm install -g nodemon
    fi
    nodemon backend/server.js
    ;;

  "fetch")
    echo ""
    echo "📄 手动执行论文采集..."
    node backend/services/scheduler.js
    ;;

  "fetch-arxiv")
    echo ""
    echo "📄 仅采集 arXiv 论文..."
    SOURCES=arxiv node backend/services/scheduler.js
    ;;

  "fetch-hf")
    echo ""
    echo "🤗 仅采集 HuggingFace 论文..."
    SOURCES=huggingface node backend/services/scheduler.js
    ;;

  *)
    echo ""
    echo "用法: ./start.sh [命令]"
    echo ""
    echo "命令:"
    echo "  start      启动 Web 服务器（默认）"
    echo "  dev        开发模式（热重载）"
    echo "  fetch      手动执行论文采集"
    echo "  fetch-arxiv  仅采集 arXiv"
    echo "  fetch-hf     仅采集 HuggingFace"
    ;;
esac
