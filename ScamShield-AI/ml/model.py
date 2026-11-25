"""Train a reproducible SMS spam baseline; synthetic fallback is explicitly labeled."""
import json, re, urllib.request, zipfile, io
from pathlib import Path
from functools import lru_cache
from sklearn.pipeline import Pipeline
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, confusion_matrix
ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data' / 'SMSSpamCollection'
URL = 'https://archive.ics.uci.edu/static/public/228/sms+spam+collection.zip'

def download():
    if DATA.exists(): return True
    try:
        with urllib.request.urlopen(URL, timeout=15) as r:
            raw = r.read(2_000_000)
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            data = z.read('SMSSpamCollection')
        if len(data.splitlines()) < 5000: raise ValueError('Incomplete dataset')
        DATA.write_bytes(data)
        print('UCI dataset downloaded.')
        return True
    except Exception as e:
        print(f'UCI download unavailable: {e}. Using clearly labeled synthetic demo dataset.')
        return False

def load_data():
    path = DATA if DATA.exists() else ROOT / 'data' / 'demo.tsv'
    seen = {}
    for line in path.read_text(encoding='utf-8', errors='replace').splitlines():
        if '\t' not in line: continue
        label, msg = line.split('\t', 1)
        if label in ('ham','spam') and msg.strip():
            seen.setdefault(re.sub(r'\s+', ' ', msg.strip().lower()), (msg.strip(), int(label == 'spam')))
    return list(seen.values()), 'UCI SMS Spam Collection (deduplicated)' if path == DATA else 'Synthetic demonstration dataset'

def pipeline():
    return Pipeline([('tfidf', TfidfVectorizer(ngram_range=(1,2), strip_accents='unicode', sublinear_tf=True, max_features=35000)), ('classifier', LogisticRegression(max_iter=1000, class_weight='balanced', random_state=42))])

@lru_cache(maxsize=1)
def get_model():
    rows, source = load_data()
    X,y = zip(*rows)
    xtrain,xtest,ytrain,ytest = train_test_split(list(X),list(y),test_size=.2,random_state=42,stratify=y)
    m=pipeline().fit(xtrain,ytrain)
    p=m.predict(xtest)
    stats={'source':source,'samples':len(X),'train_samples':len(xtrain),'test_samples':len(xtest),'spam_samples':sum(y),'accuracy':round(float(accuracy_score(ytest,p)),4),'precision':round(float(precision_score(ytest,p,zero_division=0)),4),'recall':round(float(recall_score(ytest,p,zero_division=0)),4),'f1':round(float(f1_score(ytest,p,zero_division=0)),4),'confusion_matrix':confusion_matrix(ytest,p,labels=[0,1]).tolist(),'synthetic':not DATA.exists(),'algorithm':'TF-IDF + Logistic Regression','evaluation':'Stratified 80/20 holdout, seed 42; exact normalized duplicates removed before splitting.'}
    return pipeline().fit(X,y),stats

if __name__ == '__main__':
    import sys
    if '--download' in sys.argv: download()
    print(json.dumps(get_model()[1],indent=2))
