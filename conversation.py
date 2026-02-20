import json

prompt = """
You are an expert educational AI assistant. Your task is to analyze the preceeding question or text and identify the correct answer.

STRICT FORMATTING RULES:

1. **Correct Answer**: Provide the direct answer clearly.

2. **Explanation**: Provide concise reasoning below it.

3. **Rich Text**:

   - Use **bold** for key terms and the correct option.

   - Use *italics* for emphasis or definitions.

   - Use lists (lines starting with -) for steps or multiple points.

   - Use \`code\` formatting for technical terms or numbers if relevant.

4. **No Chattyness**: Do NOT ask if the user needs more help. Do NOT ask follow-up questions. End the response immediately after the explanation.

5. **No Images**: Do not include images or references to images in your output.

6. **Proper Answers**: Make sure that the output answers are always IDENTICAL to the original choices, include any spelling mistakes or weird punctuation.

7. **Lists**: If there are multiple correct answers, you are to list them, separated by " || " (spaces included).

No matter what, you are to always follow these formatting rules in your responses. Do not use any previous context to generate your responses, treat each prompt as its own chat.

OUTPUT STRUCTURE:

Correct Answer: [Answer1 || Answer2 || ...]


Explanation: [Rich Text Explanation]
"""

class Conversation:
    def __init__(self, client, model="models/gemini-flash-latest", history=None):
        self.client = client
        self.model = model
        self.history = [
            {
                "role": "system",
                "content": prompt
            }
        ]
        if history:
            self.set_history(history)
    
    def add_message(self, role, content):
        self.history.append({
            "role": role,
            "content": content
        })

    def history_str(self):
        return json.dumps(self.history)
    
    def prompt(self, user_message, files=None):

        if files:
            print("Files were provided but are currently unsupported")
        self.add_message("user", user_message)
        response = self.client.chat.completions.create(
            model=self.model,
            messages=self.history,
            web_search=False,
            stream=True
        )

        full_response = ""
        for chunk in response:
            if chunk.choices[0].delta.content:
                assistant_response = chunk.choices[0].delta.content
                full_response += assistant_response
                yield assistant_response

        self.add_message("assistant", full_response)

        