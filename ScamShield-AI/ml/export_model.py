"""Optional offline training/export. Netlify does not require Python."""
import json, sys
from pathlib import Path
from model import get_model, download
if '--download' in sys.argv: download()
model, stats = get_model()
path = Path(__file__).resolve().parents[1] / 'server' / 'model.mjs'
old = path.read_text(encoding='utf-8')
head, rest = old.split(';\nexport const modelStats=', 1)
previous = json.loads(head.removeprefix('const M='))
vectorizer = model.named_steps['tfidf']
classifier = model.named_steps['classifier']
terms = {term: [round(float(vectorizer.idf_[idx]),10), round(float(classifier.coef_[0,idx]),10)] for term,idx in vectorizer.vocabulary_.items()}
payload = {'terms':terms,'intercept':round(float(classifier.intercept_[0]),10),'stats':stats,'rules':previous['rules']}
path.write_text('const M='+json.dumps(payload,ensure_ascii=False,separators=(',',':'))+';\nexport const modelStats='+rest,encoding='utf-8')
print('Exported',stats['source'],len(terms),'features')
