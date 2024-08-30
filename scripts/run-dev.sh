# check if pnpm installed, if not install it, else echo message
if ! [ -x "$(command -v pnpm)" ]; then
  echo 'Error: pnpm is not installed.' >&2
  echo 'Installing pnpm...'
  npm install -g pnpm
else
  echo 'pnpm is installed.'
fi

echo 'Installing dependencies...'
pnpm install

# echo 'Starting influxDB & grafana...'
# cd collector && docker-compose up -d && cd ..

echo 'Starting core services...'
cd core && pnpm run start:dev 
