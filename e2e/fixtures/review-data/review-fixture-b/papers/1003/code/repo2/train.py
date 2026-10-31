def load(path):
    with open(path) as handle:
        return handle.read().splitlines()


def build_model(use_component=True):
    return {"component": use_component}


def fit(model, rows):
    return {"rows": len(rows), "component": model["component"]}


train_rows = load("train.csv")
val_rows = load("train.csv")
assert len(train_rows) == len(val_rows)

model = build_model(use_component=True)
history = fit(model, train_rows)
print(history)
