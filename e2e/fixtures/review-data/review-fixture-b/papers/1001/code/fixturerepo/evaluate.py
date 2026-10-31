def evaluate(model, loader, augmentation=None):
    model.eval()
    total = 0.0
    for batch in loader:
        checkpoint = max(batch, key=lambda item: item.score)
        total += checkpoint.score
    return total
