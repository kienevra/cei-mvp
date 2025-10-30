import sys
sys.path.insert(0, "backend")
from app.main import app

routes = []
for r in app.routes:
    methods = getattr(r, "methods", None)
    routes.append((r.path, sorted(list(methods)) if methods else []))

routes.sort()
for p, m in routes:
    print(f"{p:40} {m}")
