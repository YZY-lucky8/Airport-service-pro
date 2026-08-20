#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""遍历文档流，找到表3-7表题对应的实际表格内容"""
from docx import Document
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph
from docx.table import Table

doc = Document(r'C:\Users\Lenovo\Desktop\Airport-service-pro-master\作品报告-用于合并_修改版.docx')

body = doc.element.body
children = list(body.iterchildren())

print("=== 文档流中表3-7附近的内容 ===")
found_37 = False
for idx, child in enumerate(children):
    if child.tag == qn('w:p'):
        para = Paragraph(child, doc)
        text = para.text.strip()
        if '表 3-7' in text or '表3-7' in text:
            found_37 = True
            print(f"\n[{idx}] 表题: {text}")
        elif found_37 and text and not text.startswith('表 3-'):
            print(f"[{idx}] 段落: {text[:80]}")
            if '3.4.4' in text or '3.5' in text:
                break
    elif child.tag == qn('w:tbl') and found_37:
        tbl = Table(child, doc)
        print(f"\n[{idx}] 表格内容 ({len(tbl.rows)}行x{len(tbl.columns)}列):")
        for ri, row in enumerate(tbl.rows):
            cells = [cell.text.strip()[:25] for cell in row.cells]
            print(f"  行{ri}: {cells}")
        # 只看第一个表格
        found_37 = False
        break
