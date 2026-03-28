---
name: chain-of-verification
description: Trigger when generating responses containing factual claims, complex logical deductions, specific dates/names, or recalled knowledge that could be hallucinated. 
---

# Chain of Verification (CoVe)

## Overview

LLMs are prone to confidently generating incorrect information (hallucinations). 
**Core Principle:** Separate generation from verification. Generate an initial answer, independently fact-check the specific claims within it, and then revise.

## When to Use

**Use for ANY response involving:**
- Factual claims (historical events, scientific data, technical specifications)
- Complex logical deductions or mathematical reasoning
- Synthesizing information from multiple distinct sources
- Recalled knowledge where you are not 100% certain of specific details
- Any time you catch yourself generating phrases like "I believe...", "It is likely...", or "If I recall correctly..."

**Don't use when:**
- Providing purely subjective opinions or creative writing (where factual accuracy is irrelevant)
- Summarizing text that is fully provided in the immediate context window
- Reporting the direct, unedited output of a tool or command

## The Four Steps

### Step 1: Generate Baseline Response
Answer the prompt normally. Formulate your best initial response without holding back or second-guessing.

### Step 2: Plan Verification Questions
Extract the core factual claims from your baseline response. Generate 3-5 targeted questions that would expose errors in those claims:
- "Is [specific claim/date/name] historically/factually accurate?"
- "Does [concept A] actually lead to [concept B]?"
- "Are the steps in this process in the correct sequential order?"
- "Am I confusing [Entity X] with [Entity Y]?"

*Key constraint: Questions must target specific, verifiable claims, not vague assessments like "Is this overall response correct?"*

### Step 3: Answer Independently
Answer each verification question **separately and independently** from your baseline response. Do not reference your initial answer while doing this. 
*Critical constraint: If you cannot independently verify a claim based on your training data or available tools, flag it as 'uncertain' rather than assuming your baseline was correct.*

### Step 4: Generate Final Verified Response
Revise your baseline response based on the verification results from Step 3:
- Correct any identified errors.
- Explicitly qualify or remove claims you could not confidently verify.
- Output the final, accurate response.

## Quick Reference

| Step | Action | Purpose |
|------|--------|---------|
| **1. Baseline** | Draft initial response | Establish the starting claims |
| **2. Questions** | Generate targeted questions | Isolate individual facts for testing |
| **3. Verify** | Answer questions independently | Prevent confirmation bias |
| **4. Revise** | Edit based on verification | Deliver accurate final output |

## Common Mistakes to Avoid

- **Vague Questions:** Asking "Is paragraph 2 right?" instead of "Did Event X happen in 1994?"
- **Confirmation Bias:** Looking at the baseline answer while answering the verification questions, leading to false confirmation.
- **Assuming the Obvious:** Skipping verification because a fact feels "obvious." Hallucinations often present as obvious truths.
- **Hiding Uncertainty:** Failing to inform the user when a specific fact could not be strictly verified.