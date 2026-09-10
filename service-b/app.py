from flask import Flask, jsonify
import random

app = Flask(__name__)

QUOTES = [
    "The cloud is just someone else's computer.",
    "It's not a bug, it's a Day 2 operations problem.",
    "99.999% uptime, 0.001% denial.",
    "There is no cloud, only YAML.",
]

@app.route("/quote")
def quote():
    return jsonify({"quote": random.choice(QUOTES)})

@app.route("/health")
def health():
    return jsonify({"status": "ok"}), 200

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
