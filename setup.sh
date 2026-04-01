# Preparation
# - brave-search API key
# - telegram bot token + chat Id
# - method to connect with OpenCode

# install node version manager (nvm)

# install bun

# install uv

# install docker engine

# run brave-search-mcp docker container

docker run -d \
  --name brave-search-mcp \
  --restart unless-stopped \
  -p 8001:8080 \
  -e BRAVE_API_KEY="api-key" \
  -e BRAVE_MCP_TRANSPORT="http" \
  -e BRAVE_MCP_ENABLED_TOOLS="brave_web_search" \
  -e BRAVE_MCP_LOG_LEVEL="debug" \
  mcp/brave-search:latest

# install google chrome

# start a chrome instance with debug port

# install opencode

# grant opencode root level permission

# install tmux

# run opencode with tmux