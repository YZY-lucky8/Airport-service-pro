import os
import re
import chromadb
from chromadb.utils import embedding_functions

# ==================== 配置区域 ====================
KNOWLEDGE_BASE_PATH = "./知识库素材"
CHUNK_SIZE = 500
PERSIST_DIR = "./chroma_db"
# =================================================


def read_markdown_files(folder_path):
    """递归读取文件夹下所有子文件夹中的 .md 文件"""
    md_files = {}
    for root, dirs, files in os.walk(folder_path):
        for filename in files:
            if filename.endswith(".md"):
                file_path = os.path.join(root, filename)
                rel_path = os.path.relpath(file_path, folder_path)
                with open(file_path, "r", encoding="utf-8") as f:
                    md_files[rel_path] = f.read()
                    print(f"   📄 读取: {rel_path}")
    return md_files


def split_text_by_chinese_characters(text, max_chars=500):
    """按字数切分文本"""
    sentences = re.split(r'(?<=[。！？\n])', text)
    chunks = []
    current_chunk = ""
    current_count = 0
    
    for sentence in sentences:
        char_count = len(re.findall(r'[\u4e00-\u9fff]', sentence))
        if char_count > max_chars and current_chunk == "":
            for i in range(0, len(sentence), max_chars):
                chunks.append(sentence[i:i+max_chars])
            continue
        if current_count + char_count > max_chars and current_chunk:
            chunks.append(current_chunk.strip())
            current_chunk = sentence
            current_count = char_count
        else:
            current_chunk += sentence
            current_count += char_count
    if current_chunk.strip():
        chunks.append(current_chunk.strip())
    return chunks


def main():
    print("=" * 50)
    print("开始处理知识库素材...")
    print("=" * 50)
    
    # 1. 递归读取所有 Markdown 文件
    print(f"\n📂 读取文件夹: {KNOWLEDGE_BASE_PATH}")
    md_files = read_markdown_files(KNOWLEDGE_BASE_PATH)
    print(f"\n✅ 共找到 {len(md_files)} 个 Markdown 文件")
    
    if len(md_files) == 0:
        print("❌ 没有找到任何 .md 文件，请检查路径是否正确")
        return
    
    # 2. 切分文本
    print("\n✂️ 开始切分文本...")
    all_chunks = []
    for rel_path, content in md_files.items():
        chunks = split_text_by_chinese_characters(content, CHUNK_SIZE)
        for idx, chunk in enumerate(chunks):
            all_chunks.append({
                "id": f"{rel_path.replace('/', '_').replace('\\', '_')}_{idx}",
                "content": chunk,
                "metadata": {
                    "source": rel_path,
                    "chunk_index": idx,
                    "total_chunks": len(chunks)
                }
            })
        print(f"   📄 {rel_path} → {len(chunks)} 个 chunk")
    
    print(f"\n✅ 总共生成 {len(all_chunks)} 个 chunk")
    
    if len(all_chunks) == 0:
        print("❌ 没有生成任何 chunk")
        return
    
    # 3. 初始化 Chroma 客户端
    print("\n🗄️ 初始化 Chroma 数据库...")
    client = chromadb.PersistentClient(path=PERSIST_DIR)
    
    # 使用 DefaultEmbeddingFunction（不需要下载模型，解决 SSL 问题）
    embedding_fn = embedding_functions.DefaultEmbeddingFunction()
    
    collection = client.get_or_create_collection(
        name="knowledge_base",
        embedding_function=embedding_fn
    )
    print(f"✅ Collection 已准备: knowledge_base (现有 {collection.count()} 条数据)")
    
    # 4. 批量导入
    print("\n📤 开始导入向量数据...")
    batch_size = 50
    for i in range(0, len(all_chunks), batch_size):
        batch = all_chunks[i:i+batch_size]
        ids = [item["id"] for item in batch]
        documents = [item["content"] for item in batch]
        metadatas = [item["metadata"] for item in batch]
        
        collection.add(ids=ids, documents=documents, metadatas=metadatas)
        print(f"   ✅ 已导入 {min(i+batch_size, len(all_chunks))}/{len(all_chunks)} 条")
    
    print(f"\n🎉 导入完成！共 {collection.count()} 条数据")
    
    # 5. 测试查询
    print("\n🔍 测试向量查询...")
    test_queries = ["充电宝", "安全检查", "液体携带"]
    for query in test_queries:
        results = collection.query(query_texts=[query], n_results=2)
        docs = results['documents'][0]
        if docs:
            print(f"\n   查询: '{query}'")
            print(f"   结果: {docs[0][:100]}...")
        else:
            print(f"\n   查询: '{query}' → 无结果")
    
    print("\n✅ 全部任务完成！")


if __name__ == "__main__":
    main()