#!/usr/bin/env python
# -*- coding: utf-8 -*-
from docx import Document
doc = Document(r'C:\Users\Lenovo\Desktop\Airport-service-pro-master\作品报告_修改版_v3.docx')
table4 = doc.tables[4]
print("=== 表4(2.7.4)完整内容 ===")
for ri, row in enumerate(table4.rows):
    cells = [cell.text.strip() for cell in row.cells]
    print(f"  行{ri}: {cells}")
