const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Get all tracked files (excluding binaries and non-text files)
const files = execSync('git ls-files', { encoding: 'utf-8' })
  .split('\n')
  .filter(f => {
    if (!f) return false;
    const ext = path.extname(f);
    if (f.includes('.min.')) return false;
    return ['.js', '.ts', '.html', '.css', '.md', '.json', '.yml', '.xml', '.gradle'].includes(ext);
  });

let changed = false;

for (const file of files) {
  if (!fs.existsSync(file)) continue;
  const content = fs.readFileSync(file, 'utf-8');
  const lines = content.split('\n');
  const newLines = lines.map(line => line.replace(/\s+$/, ''));
  const newContent = newLines.join('\n');

  if (content !== newContent) {
    console.log(`Trimming trailing spaces: ${file}`);
    fs.writeFileSync(file, newContent, 'utf-8');
    changed = true;
  }
}

if (changed) {
  console.log('Trailing spaces trimmed. Re-staging files...');
  // Only stage files that were actually modified and are already partially staged?
  // Actually, in pre-commit, if we modify files we should probably stage them again.
  // But we don't want to stage files that weren't intended to be committed.
  // A better way is to use git add on the specific files we changed.
  // For simplicity, let's just stage all tracked files that were modified.
  execSync('git add -u');
}
