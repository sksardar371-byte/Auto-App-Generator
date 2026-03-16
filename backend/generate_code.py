# generate_code.py

from transformers import AutoTokenizer, AutoModelForCausalLM
import torch
import os

# ---------- SETTINGS ----------
MODEL_NAME = "Salesforce/codegen-350M-mono"  # Open-source, no login needed
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
OUTPUT_DIR = "generated_app"
OUTPUT_FILE = "app.js"

# ---------- PROMPT ----------
prompt = """
# Node.js Express backend app
# Features:
# - User login/register
# - MongoDB database
# - JWT authentication
# - API endpoints for users
# Write the complete code for this backend in Node.js with Express.
"""

# ---------- CREATE OUTPUT FOLDER ----------
if not os.path.exists(OUTPUT_DIR):
    os.makedirs(OUTPUT_DIR)

# ---------- LOAD MODEL ----------
print("Loading model...")
tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
model = AutoModelForCausalLM.from_pretrained(MODEL_NAME).to(DEVICE)

# ---------- TOKENIZE PROMPT ----------
inputs = tokenizer(prompt, return_tensors="pt").to(DEVICE)

# ---------- GENERATE CODE ----------
print("Generating code...")
outputs = model.generate(
    **inputs,
    max_length=1024,  # increase if code is long
    num_beams=5,
    early_stopping=True,
    pad_token_id=tokenizer.eos_token_id
)

generated_code = tokenizer.decode(outputs[0], skip_special_tokens=True)

# ---------- SAVE TO FILE ----------
with open(os.path.join(OUTPUT_DIR, OUTPUT_FILE), "w", encoding="utf-8") as f:
    f.write(generated_code)

print(f"✅ Code generated successfully! Saved to {OUTPUT_DIR}/{OUTPUT_FILE}")
print("\n--- PREVIEW ---\n")
print(generated_code[:500] + "\n...")  # show first 500 characters
