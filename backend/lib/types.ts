export type Role = "student" | "admin";

export type User = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  createdAt: string;
};

export type NoteFile = {
  id: string;
  userId: string;
  filename: string;
  type: "text/plain" | "application/pdf";
  size: number;
  text: string;
  createdAt: string;
};

export type ChatMessage = {
  id: string;
  userId: string;
  question: string;
  answer: string;
  createdAt: string;
};

export type Quiz = {
  id: string;
  userId: string;
  title: string;
  content: string;
  createdAt: string;
};

export type Database = {
  users: User[];
  files: NoteFile[];
  chats: ChatMessage[];
  quizzes: Quiz[];
};
