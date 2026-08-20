#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""修正2.7.5节中与性能指标不一致的旧描述"""
from docx import Document
from docx.shared import Pt
from docx.oxml.ns import qn

doc = Document(r'C:\Users\Lenovo\Desktop\Airport-service-pro-master\作品报告_修改版_v2.docx')

def set_para_text(para, text):
    if para.runs:
        for run in para.runs:
            run.text = ''
        para.runs[0].text = text
    else:
        para.text = text

# 需要修正的段落内容映射
corrections = {
    '内存≈70MB': '内存≈77MB',
    '稳定值维持 65~75MB 区间': '稳定值维持70~80MB区间，启动初始约51MB，压测峰值约96MB',
    '布隆过滤器 12KB / 万条 IP': '布隆过滤器≈18KB/万条IP',
    '位数组参数 10000 容量、3 个哈希函数': '代码参数BloomFilter(10000, 0.001)，按公式动态计算得143773位（≈17.5KB）、10个哈希函数',
    '测试用例通过率 95.3%、API 覆盖率 93%': '功能测试36项全部通过（100%），核心API接口全部验证通过',
    'Jest 自动化测试脚本，统计总用例、通过用例数量；接口测试工具统计覆盖接口总数': '基于Postman/手动接口测试覆盖全部核心功能模块，统计测试项与通过数量',
}

print("=== 修正2.7.5节旧描述 ===")
count = 0
for i, para in enumerate(doc.paragraphs):
    text = para.text.strip()
    for old, new in corrections.items():
        # 去掉空格比较
        old_clean = old.replace(' ', '')
        text_clean = text.replace(' ', '')
        if old_clean in text_clean:
            # 替换文本
            new_text = text.replace(old, new)
            # 如果没替换成功，尝试去掉空格的版本
            if new_text == text:
                # 手动构建新文本
                for old_variant in [old, old.replace(' ', '')]:
                    if old_variant in text:
                        new_text = text.replace(old_variant, new)
                        break
            set_para_text(para, new_text)
            print(f"  段落{i}: '{old[:30]}...' -> '{new[:30]}...'")
            count += 1
            break

print(f"\n共修正{count}处")

# 保存
doc.save(r'C:\Users\Lenovo\Desktop\Airport-service-pro-master\作品报告_修改版_v2.docx')
print("✅ 保存完成")
