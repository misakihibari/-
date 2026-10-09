// JSONファイルによる簡易ストア(単一ユーザー・小規模向け)。書き込みは一時ファイル経由で原子的に行う。
import fs from 'node:fs';
import path from 'node:path';

export class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'db.json');
    fs.mkdirSync(dir, { recursive: true });
    this.data = { genres: [], reminders: [], subscriptions: [] };
    if (fs.existsSync(this.file)) {
      this.data = { ...this.data, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } else {
      this.data.genres = [
        { id: 'g-work', name: '仕事', icon: '💼', color: '#4f6df5' },
        { id: 'g-life', name: '生活', icon: '🏠', color: '#2fb579' },
        { id: 'g-health', name: '健康', icon: '💊', color: '#e8643c' },
      ];
      this.save();
    }
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
