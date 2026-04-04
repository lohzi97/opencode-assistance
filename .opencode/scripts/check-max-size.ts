async function main() {
  const file = process.argv[2];
  const max = Number(50000); // bytes

  if (!file) {
    console.error("Missing file path argument");
    process.exit(1);
  }

  const src = Bun.file(file);
  if (!(await src.exists())) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }

  if (src.size <= max) process.exit(0);

  console.error(`File exceeds max size: ${file}`);
  console.error(`Size: ${src.size} bytes`);
  console.error(`Limit: ${max} bytes`);
  process.exit(1);
}

if (import.meta.main) await main();
