"""Synthetic check script used by the evidence fixture."""

from pathlib import Path


def main() -> None:
    rows = Path(__file__).with_name("check_split.csv").read_text().splitlines()
    for row in rows[1:]:
        print(row)


if __name__ == "__main__":
    main()
