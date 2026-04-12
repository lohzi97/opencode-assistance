### Start chrome in debug mode

```bash
google-chrome-stable --remote-debugging-port=9222 --user-data-dir=/home/lohzi/Documents/chrome-temp/personal-chrome-1
```

### Start brave search mcp

```bash
docker run -d \
  --name brave-search-mcp \
  --restart unless-stopped \
  -p 9999:8080 \
  -e BRAVE_API_KEY="api-key" \
  -e BRAVE_MCP_TRANSPORT="http" \
  -e BRAVE_MCP_ENABLED_TOOLS="brave_web_search" \
  -e BRAVE_MCP_LOG_LEVEL="debug" \
  mcp/brave-search:latest
```
