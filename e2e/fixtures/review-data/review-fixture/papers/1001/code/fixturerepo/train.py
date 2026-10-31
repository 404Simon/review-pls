import random

from fixturerepo.evaluate import evaluate


def train(model, train_loader, test_loader, seed):
    random.seed(seed)
    candidates = build_candidates()
    scores = {}
    for aug in candidates:
        val_acc = evaluate(model, test_loader, aug)
        scores[aug] = val_acc
    best_aug = max(candidates, key=lambda aug: scores[aug])
    return best_aug


def main(seed):
    random.seed(seed)
    model = build_model()
    train_loader, test_loader = build_loaders()
    best_aug = train(model, train_loader, test_loader, seed)
    random.seed(seed)
    return best_aug
