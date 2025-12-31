# Advanced CommerceOS API Queries

This document contains 300 advanced GET query examples demonstrating nested operators, filtering, projections, and path navigation.

> **Note**: All example paths assume the `/v1` API version prefix. For example, `/people` should be requested as `GET /v1/people`.

## Query Syntax Reference

### Operators
- `~with(selectors...)` - Include/expand specified members
- `~withAll` - Include all members (no parentheses; has no indexer)
- `~without(selectors...)` - Exclude specified members
- `~just(selectors...)` - Include ONLY specified members (projection)
- `~where(predicates)` - Filter by conditions
- `~orderBy(field)` / `~orderBy(field:desc)` - Sort results
- `~distinct` - Deduplicate primitive streams (use after `~map(...)`)
- `~distinctBy(field)` - Deduplicate object streams by field
- `~take(n)` / `~skip(n)` - Pagination
- `~first` / `~last` / `~count` - Single element or count
- `~flat` - Flatten nested arrays
- `~join(separator)` - Join array to string

### Selector Syntax
- `member` - Access a member
- `member/nested` - Nested path navigation
- `alias:member` - Rename output field
- `member~operator()` - Apply operator to member

### Where Predicates
- `field=value` - Equals
- `field!=value` - Not equals
- `field>value` / `field<value` - Greater/less than
- `field>=value` / `field<=value` - Greater/less or equal
- `field=~value` - Contains (string/array)
- `field!~value` - Not contains
- `field` - Truthy check
- `!field` - Falsy check
- Multiple: `cond1,cond2` or `cond1&cond2`

---

## 1. People Queries (1-30)

### Basic Projections
```
1.  GET /people~just(name, identifiers)
2.  GET /people~just(givenName, familyName, email:contactMethods/email)
3.  GET /people~just(fullName:name, id:identifiers/key)
4.  GET /people~take(10)~just(name, nationality)
5.  GET /people~just(identifiers, givenName, familyName, addresses/main)
```

### Filtering
```
6.  GET /people~where(nationality=SE)
7.  GET /people~where(givenName=John)~take(5)
8.  GET /people~where(familyName=~son)
9.  GET /people~where(name)~take(20)
10. GET /people~where(!contactMethods/email)~take(10)
```
Note: Query 10 uses `contactMethods/email` because `email` lives under the `contactMethods` member.

### With Relations
```
11. GET /people~with(supplierRelations)~take(5)
12. GET /people~with(customerRelations~just(supplierAgent/name))~take(5)
13. GET /people~with(supplierRelations~just(supplierName:supplierAgent/name, supplierId:supplierAgent/identifiers/key))
14. GET /people~with(timeline~take(3))~take(5)
15. GET /people~with(addresses)~where(addresses/main/countryCode=SE)
```

### Ordering
```
16. GET /people~orderBy(familyName)~take(20)
17. GET /people~orderBy(givenName:desc)~take(20)
18. GET /people~where(nationality=SE)~orderBy(name)
19. GET /people~orderBy(identifiers/key:desc)~take(10)
20. GET /people~where(familyName=~Berg)~orderBy(givenName)
```
Note: Query 19 corrected - people don't have `createdAt` (only product nodes do).

### Complex Combinations
```
21. GET /people~where(nationality=SE)~with(supplierRelations~just(supplierAgent/name))~take(10)
22. GET /people~just(name, supplierCount:supplierRelations~count)
23. GET /people~with(customerRelations~where(supplierAgent/name=~AB))
24. GET /people~with(labels)~where(labels~count>0)~take(10)
25. GET /people~just(identifiers, name, mainAddress:addresses/main, email:contactMethods/email)
```

### Deep Nesting
```
26. GET /people~with(supplierRelations~with(supplierAgent~just(name, identifiers)))~take(5)
27. GET /people~with(timeline~just(identifiers, timestamp, items~take(2)))~take(3)
28. GET /people~with(customerRelations~just(customerAgent~just(name, nationality)))
29. GET /people~just(name, suppliers:supplierRelations~just(name:supplierAgent/name)~take(3))
30. GET /people~with(addresses~just(main, delivery))~where(addresses/delivery)~take(10)
```

---

## 2. Companies Queries (31-55)

### Basic
```
31. GET /companies~just(name, identifiers)~take(20)
32. GET /companies~where(name=~AB)
33. GET /companies~orderBy(name)~take(50)
34. GET /companies~just(name, vatId)~where(vatId)
35. GET /companies~count
```

### With Assortment and Relations (Note: companies don't have `stores` member)
```
36. GET /companies~with(customerRelations~take(5))~take(5)
37. GET /companies~with(supplierRelations~just(customerAgent/name, customerId))
38. GET /companies~just(name, relationCount:customerRelations~count)
39. GET /companies~with(customerRelations~where(customerAgent/@type=person))~take(10)
40. GET /companies~with(supplierRelations~orderBy(customerId)~take(3))~take(5)
```
Note: Queries 36-40 corrected - companies don't have a `stores` member. To find stores by owner, use `/stores~where(owner/identifiers/key=...)`.

### With Relations
```
41. GET /companies~with(customerRelations)~take(5)
42. GET /companies~with(supplierRelations~just(customerAgent/name))
43. GET /companies~just(name, customers:customerRelations~count)
44. GET /companies~with(customerRelations~where(customerAgent/@type=person))
45. GET /companies~with(manufacturerRelations)~take(5)
```

### Assortment
```
46. GET /companies~with(assortmentRoots~take(5))
47. GET /companies~just(name, assortmentSize:assortmentRoots~count)
48. GET /companies~with(assortment~take(10))~take(3)
49. GET /companies~with(assortmentRoots~just(name, hidden))~take(5)
50. GET /companies~with(assortment~where(hidden=false)~take(5))
```
Note: Queries 49-50 use `hidden` instead of `status` — `assortmentRoots` and `assortment` are product nodes, which have `hidden` but not `status`.

### Complex
```
51. GET /companies~where(assortment~count>0)~just(name, assortment~just(name)~take(5))
52. GET /companies~with(assortmentRoots~with(categories~take(3)))~take(3)
53. GET /companies~just(name, addresses/main/cityName)~where(addresses/main)
54. GET /companies~with(preferredCurrency)~where(preferredCurrency)
55. GET /companies~with(labels)~just(name, labels)~take(10)
```
Note: Queries 51-52 corrected to use `assortment`/`assortmentRoots` instead of `stores`.

---

## 3. Stores Queries (56-85)

### Basic
```
56. GET /stores~just(name, identifiers)~take(20)
57. GET /stores~orderBy(name)
58. GET /stores~where(name=~Store)~take(10)
59. GET /stores~count
60. GET /stores~just(name, ownerName:owner/name)
```

### With Owner
```
61. GET /stores~with(owner)~take(10)
62. GET /stores~just(name, owner~just(name, identifiers))
63. GET /stores~with(owner~just(name, vatId))~take(5)
64. GET /stores~where(owner/name=~AB)
65. GET /stores~just(name, companyName:owner/name, companyVat:owner/vatId)
```

### With Stock
```
66. GET /stores~with(stockRoots)~take(5)
67. GET /stores~just(name, stockPlaces:stockRoots~count)
68. GET /stores~with(stockRoots~just(name, identifiers))~take(5)
69. GET /stores~with(stockRoots~with(transactions~take(5)))~take(3)
70. GET /stores~with(stockRoots~with(children~take(3)))~take(3)
```
Note: Query 69 corrected - agents don't have `stockTransactions`. Use `stockRoots/transactions` instead.

### With Timeline (Receipts) - Note: Stores don't have direct `tradeOrders` member
```
71. GET /stores~with(timeline~take(5))~take(3)
72. GET /stores~just(name, receiptCount:timeline~count)
73. GET /stores~with(timeline~take(5))~take(5)
74. GET /stores~with(timeline~just(identifiers, timestamp)~take(10))~take(5)
75. GET /stores~with(timeline~take(5))~orderBy(name)~take(3)
```
Note: Queries 71-75 corrected - stores don't have `tradeOrders`. Use `timeline` for receipts, or query `/trade-orders~where(sellers/identifiers/key=STORE_KEY)` directly.

### With Assortment
```
76. GET /stores~with(assortment~take(10))~take(3)
77. GET /stores~just(name, productCount:assortment~count)
78. GET /stores~with(assortment~where(status=Active)~take(5))
79. GET /stores~with(assortmentRoots~just(name))~take(5)
80. GET /stores~with(assortment~just(name, gtin)~take(10))~take(3)
```

### Complex
```
81. GET /stores~with(owner~just(name), stockRoots~just(name)~take(3))~take(5)
82. GET /stores~just(name, owner/name, stockCount:stockRoots~count, assortmentCount:assortment~count)
83. GET /stores~with(timeline~take(5), assortment~take(5))~take(3)
84. GET /stores~where(assortment~count>100)~just(name, productCount:assortment~count)
85. GET /stores~with(supplierRelations~just(supplierAgent~just(name)))~take(5)
```
Note: Queries 82-83 corrected to remove `tradeOrders`.

---

## 4. Products Queries (86-145)

### Basic Projections
```
86.  GET /products~just(name, identifiers)~take(50)
87.  GET /products~just(name, gtin, status)~take(20)
88.  GET /products~where(status=Active)~take(50)
89.  GET /products~orderBy(name)~take(100)
90.  GET /products~just(name, gtin, plu)~where(plu)
```
Note: Products expose `plu` (string[]), alongside `gtin`. Both can be used for barcode lookups.

### Filtering
```
91.  GET /products~where(status=Active)~orderBy(name)~take(20)
92.  GET /products~where(name=~Phone)
93.  GET /products~where(gtin=~123)
94.  GET /products~where(status!=Active)~take(20)
95.  GET /products~where(hidden=false)~take(50)
```

### With Categories
```
96.  GET /products~with(categories)~take(10)
97.  GET /products~just(name, categories~just(category/name))
98.  GET /products~with(categories~just(categoryName:category/name, weight))~take(10)
99.  GET /products~where(categories~count>0)~take(20)
100. GET /products~just(name, categoryCount:categories~count)~take(50)
```

### With Prices
```
101. GET /products~with(prices)~take(10)
102. GET /products~just(name, prices~just(amount, currency/identifiers/currencyCode))
103. GET /products~with(prices~where(amount>0))~take(10)
104. GET /products~just(name, priceCount:prices~count)
105. GET /products~with(prices~just(amount, sellers~just(name)))~take(5)
```

### With Assortment
```
106. GET /products~with(assortmentOwners)~take(10)
107. GET /products~with(assortmentContexts)~take(5)
108. GET /products~just(name, assortmentContexts~just(owner/name, articleNumber))
109. GET /products~with(assortmentContexts~just(ownerName:owner/name, artNr:articleNumber))~take(10)
110. GET /products~just(name, ownerCount:assortmentOwners~count)~take(50)
```

### With Stock
```
111. GET /products~with(stockLevels)~take(5)
112. GET /products~just(name, stockLevels~just(location/name, availableQuantity))
113. GET /products~with(stockLevels~where(availableQuantity>0))~take(10)
114. GET /products~just(name, stock:stockLevels~just(loc:location/name, qty:availableQuantity))
115. GET /products~with(stockLevels~just(totalQuantity, reservedQuantity, availableQuantity))~take(5)
```

### With Images
```
116. GET /products~with(images)~take(10)
117. GET /products~just(name, imageCount:images~count)~take(50)
118. GET /products~with(images~just(identifiers/url))~take(10)
119. GET /products~where(images~count>0)~take(20)
120. GET /products~with(images~take(1))~take(20)
```
Note: Query 118 uses `identifiers/url` — images only have `identifiers.url`, no `mimeType` or other metadata fields.

### With Labels
```
121. GET /products~with(labels)~take(10)
122. GET /products~just(name, labels~just(name, color))~take(20)
123. GET /products~where(labels~count>0)~take(20)
124. GET /products~with(labels~where(name=~Sale))~take(10)
125. GET /products~just(name, labelCount:labels~count)~take(50)
```

### Sales Channels
```
126. GET /products~with(salesChannels)~take(10)
127. GET /products~just(name, salesChannels~just(name))
128. GET /products~where(salesChannels~count>0)~take(20)
129. GET /products~with(salesChannels~just(name, identifiers))~take(10)
130. GET /products~just(name, channelCount:salesChannels~count)
```

### Cross References
```
131. GET /products~with(xrefs/compatibles~take(5))~take(5)
132. GET /products~with(xrefs/alternatives~take(5))~take(5)
133. GET /products~just(name, compatibles:xrefs/compatibles~just(name)~take(3))
134. GET /products~just(name, alternatives:xrefs/alternatives~just(name)~take(3))
135. GET /products~with(xrefs~just(compatibles~take(3), alternatives~take(3)))~take(5)
```

### Complex Combinations
```
136. GET /products~where(status=Active)~with(categories, prices)~take(10)
137. GET /products~just(name, gtin, status, categories~just(category/name), prices~just(amount))~take(10)
138. GET /products~where(status=Active,categories~count>0)~orderBy(name)~take(20)
139. GET /products~with(assortmentContexts~just(owner~just(name,@type), articleNumber))~take(5)
140. GET /products~just(name, createdBy/name, createdAt)~orderBy(createdAt:desc)~take(20)
```

### Deep Nesting
```
141. GET /products~with(categories~with(category~just(name, childCategories~take(3))))~take(5)
142. GET /products~with(prices~with(sellers~just(name, identifiers), currency))~take(5)
143. GET /products~with(assortmentContexts~with(owner~with(addresses/main)))~take(3)
144. GET /products~with(stockLevels~with(location~just(name,@type)))~take(3)
145. GET /products~just(name, cats:categories~just(catName:category/name, catWeight:weight)~take(3))~take(20)
```
Note: Query 144 corrected — `stockLevels.location` is typed as `agent?`, and `owner` is only available on `store`. Use `~just(name,@type)` instead of `~just(name, owner/name)`.

---

## 5. Product Categories Queries (146-170)

### Basic
```
146. GET /product-categories~just(name, identifiers)~take(50)
147. GET /product-categories~orderBy(name)
148. GET /product-categories~where(name=~Electronics)
149. GET /product-categories~count
150. GET /product-categories~just(name)~orderBy(name)~take(100)
```

### Hierarchy
```
151. GET /product-categories~with(childCategories)~take(20)
152. GET /product-categories~just(name, childCount:childCategories~count)
153. GET /product-categories~with(childCategories~just(name))~take(10)
154. GET /product-categories~where(childCategories~count=0)~take(20)
155. GET /product-categories~with(childCategories~take(5))~orderBy(name)~take(20)
```
Note: Queries 151-155 use `childCategories` — product categories don't have a `parent` member. Categories only expose their children via `childCategories`. To find root categories (those without a parent), query categories that aren't in any other category's `childCategories`.

### With Members (Products)
```
156. GET /product-categories~with(members~take(5))~take(10)
157. GET /product-categories~just(name, productCount:members~count)
158. GET /product-categories~with(members~just(name, status))~take(5)
159. GET /product-categories~with(members~where(status=Active)~take(10))~take(5)
160. GET /product-categories~just(name, members~just(name)~take(5))~take(10)
```

### Complex
```
161. GET /product-categories~where(childCategories~count>0)~with(childCategories~just(name))
162. GET /product-categories~just(name, childCount:childCategories~count, memberCount:members~count)~take(50)
163. GET /product-categories~with(childCategories~with(members~take(3)))~take(5)
164. GET /product-categories~where(members~count>10)~just(name, count:members~count)
165. GET /product-categories~with(childCategories~just(name, memberCount:members~count)~take(5))~take(10)
```
Note: Queries 161, 162, 165 updated — product categories don't have a `parent` member, only `childCategories`. Hierarchy is navigated top-down via children.

### Deep Hierarchy
```
166. GET /product-categories~with(childCategories~with(childCategories~just(name)))~take(5)
167. GET /product-categories~just(name, level1:childCategories~just(name, level2:childCategories~just(name)))
168. GET /product-categories~with(childCategories~with(members~just(name)~take(2)))~take(3)
169. GET /product-categories~orderBy(name)~with(childCategories~orderBy(name))~take(20)
170. GET /product-categories~with(members~with(prices~just(amount)))~take(3)
```
Note: Queries 166, 169 updated — there is no `parent` member on product categories. Top-level categories must be identified externally or by checking which categories aren't children of others.

---

## 6. Product Groups Queries (171-190)

### Basic
```
171. GET /product-groups~just(name, identifiers)~take(50)
172. GET /product-groups~orderBy(name)~take(100)
173. GET /product-groups~where(name=~Group)
174. GET /product-groups~count
175. GET /product-groups~just(name)~take(50)
```

### Hierarchy
```
176. GET /product-groups~with(parentGroup)~take(20)
177. GET /product-groups~just(name, parentName:parentGroup/name)
178. GET /product-groups~with(members)~take(10)
179. GET /product-groups~just(name, memberCount:members~count)
180. GET /product-groups~where(!parentGroup)~take(20)
```
Note: Queries 176-180 use `parentGroup` and `members` — product groups don't have `parent`/`children` members. The hierarchy uses `parentGroup` to reference the parent and `members` for child nodes.

### With Members
```
181. GET /product-groups~with(members~take(5))~take(10)
182. GET /product-groups~just(name, productCount:members~count)
183. GET /product-groups~with(members~just(name, gtin))~take(5)
184. GET /product-groups~with(members~where(status=Active)~take(5))~take(5)
185. GET /product-groups~just(name, members~just(name)~take(3))~take(20)
```

### Complex
```
186. GET /product-groups~where(!parentGroup)~with(members~just(name))
187. GET /product-groups~just(name, parentGroup/name, memberCount:members~count)~take(50)
188. GET /product-groups~with(members~with(members~take(2)))~take(3)
189. GET /product-groups~where(members~count>5)~just(name, count:members~count)
190. GET /product-groups~with(members~with(categories~just(category/name)))~take(3)
```
Note: Queries 186-188 use `parentGroup` and `members` — product groups don't have `parent`/`children` members.

---

## 6b. Product Families and Variants Queries

Product families group variant products (same base product with different size, color, etc.). Variants are regular products attached to a family via `parentGroup`.

### Basic Family Queries
```
F1.  GET /product-families~just(name, identifiers)~take(50)
F2.  GET /product-families~with(variants)~take(10)
F3.  GET /product-families~just(name, variantCount:variants~count)~take(50)
F4.  GET /product-families~where(variants~count>0)~take(20)
F5.  GET /product-families~with(parentGroup)~take(20)
```

### Variant Expansions
```
F6.  GET /product-families~with(variants~just(name, identifiers))~take(10)
F7.  GET /product-families~with(variants~just(name, status))~take(10)
F8.  GET /product-families~with(variants/prices)~take(5)
F9.  GET /product-families~with(variants/stockLevels)~take(5)
F10. GET /product-families~with(variants~with(prices, categories))~take(3)
```
Note: Use `~with(variants/...)` patterns to fetch variant details efficiently.

### Filtering Variants
```
F11. GET /product-families~with(variants~where(status=Active))~take(10)
F12. GET /product-families~with(variants~where(gtin=~123))~take(10)
F13. GET /product-families~with(variants~orderBy(name)~take(5))~take(5)
F14. GET /product-families~just(name, activeVariants:variants~where(status=Active)~count)
F15. GET /product-families~with(variants~where(stockLevels~count>0))~take(5)
```

### Family Hierarchy
```
F16. GET /product-families~with(parentGroup~just(name, identifiers))~take(20)
F17. GET /product-families~just(name, groupName:parentGroup/name)~take(50)
F18. GET /product-families~where(parentGroup/name=~Apparel)~take(20)
F19. GET /product-groups~with(members~where(@type=product family))~take(10)
F20. GET /product-groups~just(name, families:members~where(@type=product family)~count)
```
Note: Product groups can contain families, which in turn contain variant products.

### Variant Dimension Queries
```
F21. GET /product-families~just(name, variantDimensions)~take(50)
F22. GET /product-families~where(variantDimensions)~take(20)
F23. GET /product-families~where(!variantDimensions)~take(20)
F24. GET /product-families~where(variantDimensions=~color)~take(20)
F25. GET /product-families~where(variantDimensions=~size, variantDimensions=~color)~take(20)
```
Note: `variantDimensions` is a comma-separated string (e.g., `"Apparel::size, Apparel::color"`), not an array.

### Products as Variants (via parentGroup)
```
F26. GET /products~where(parentGroup/@type=product family)~take(50)
F27. GET /products~with(parentGroup)~where(parentGroup/@type=product family)~take(20)
F28. GET /products~just(name, familyName:parentGroup/name)~where(parentGroup/@type=product family)
F29. GET /products~where(instanceType=Apparel)~take(50)
F30. GET /products~where(instanceType)~just(name, instanceType)~take(50)
```
Note: Variants are products with `parentGroup` pointing to a product family. Use `instanceType` to query products by their variant classification.

---

## 7. Trade Relationships Queries (191-220)

### Basic
```
191. GET /trade-relationships~just(identifiers)~take(50)
192. GET /trade-relationships~take(20)
193. GET /trade-relationships~count
194. GET /trade-relationships~skip(10)~take(10)
195. GET /trade-relationships~orderBy(identifiers/key)~take(50)
```

### With Agents
```
196. GET /trade-relationships~with(supplierAgent, customerAgent)~take(10)
197. GET /trade-relationships~just(supplierName:supplierAgent/name, customerName:customerAgent/name)~take(50)
198. GET /trade-relationships~with(supplierAgent~just(name, identifiers))~take(10)
199. GET /trade-relationships~with(customerAgent~just(name, @type))~take(10)
200. GET /trade-relationships~just(supplier:supplierAgent~just(name,@type), customer:customerAgent~just(name,@type))
```

### Filtering by Agent Type
```
201. GET /trade-relationships~where(customerAgent/@type=person)~take(20)
202. GET /trade-relationships~where(customerAgent/@type=company)~take(20)
203. GET /trade-relationships~where(supplierAgent/@type=company)~take(20)
204. GET /trade-relationships~where(customerAgent/@type=store)~take(20)
205. GET /trade-relationships~where(supplierAgent/name=~AB)~take(20)
```

### Filtering by Agent Name
```
206. GET /trade-relationships~where(customerAgent/name=~Test)~take(20)
207. GET /trade-relationships~where(supplierAgent/name=~Corp)~take(20)
208. GET /trade-relationships~just(identifiers, supplierAgent/name, customerAgent/name)~where(customerAgent/name)
209. GET /trade-relationships~where(supplierAgent/name,customerAgent/name)~take(20)
210. GET /trade-relationships~where(supplierAgent/vatId)~take(10)
```

### Complex
```
211. GET /trade-relationships~with(supplierAgent~just(name, assortment~count))~take(10)
212. GET /trade-relationships~with(customerAgent~with(addresses/main))~take(5)
213. GET /trade-relationships~just(supplierAgent~just(name,identifiers), customerAgent~just(name,identifiers))~take(20)
214. GET /trade-relationships~with(supplierAgent~with(assortmentRoots~just(name)~take(3)))~take(5)
215. GET /trade-relationships~where(customerAgent/@type=person)~with(customerAgent~just(givenName, familyName))
```
Note: Query 211, 214 corrected - agents don't have `stores`, using `assortment`/`assortmentRoots` instead.

### Deep Nesting
```
216. GET /trade-relationships~with(supplierAgent~with(assortmentRoots~take(3)))~take(3)
217. GET /trade-relationships~with(customerAgent~with(supplierRelations~take(2)))~take(3)
218. GET /trade-relationships~just(supplier:supplierAgent~just(name, currency:preferredCurrency/identifiers/currencyCode))
219. GET /trade-relationships~with(supplierAgent~just(name, assortmentCount:assortment~count))~where(supplierAgent/assortment~count>0)
220. GET /trade-relationships~with(customerAgent~with(labels))~take(5)
```
Note: Query 219 corrected - agents don't have `stores`, using `assortment` instead.

---

## 8. Trade Orders Queries (221-265)

### Basic
```
221. GET /trade-orders~just(identifiers, timestamp)~take(50)
222. GET /trade-orders~orderBy(timestamp:desc)~take(20)
223. GET /trade-orders~count
224. GET /trade-orders~where(status=~New)~take(20)
225. GET /trade-orders~just(identifiers, totalAmount, balanceAmount)~take(50)
```

### With Parties
```
226. GET /trade-orders~with(supplier, customer)~take(10)
227. GET /trade-orders~just(supplierName:supplier/name, customerName:customer/name)~take(50)
228. GET /trade-orders~with(supplier~just(name, identifiers), customer~just(name))~take(10)
229. GET /trade-orders~with(sellers)~take(10)
230. GET /trade-orders~just(timestamp, sellers~just(name)~first)~take(50)
```

### With Currency
```
231. GET /trade-orders~with(currency)~take(20)
232. GET /trade-orders~just(totalAmount, currencyCode:currency/identifiers/currencyCode)~take(50)
233. GET /trade-orders~where(currency/identifiers/currencyCode=SEK)~take(20)
234. GET /trade-orders~just(identifiers, totalAmount, currency~just(identifiers/currencyCode))
235. GET /trade-orders~with(currency~just(identifiers))~take(20)
```

### With Items
```
236. GET /trade-orders~with(items~take(5))~take(10)
237. GET /trade-orders~just(timestamp, itemCount:items~count)~take(50)
238. GET /trade-orders~with(items~just(product/name, quantity))~take(5)
239. GET /trade-orders~with(items~just(productName:product/name, qty:quantity, amt:totalAmount))~take(10)
240. GET /trade-orders~with(items~where(quantity>1))~take(10)
```

### Filtering by Status
```
241. GET /trade-orders~where(status=~New)~take(20)
242. GET /trade-orders~where(status=~Approved)~take(20)
243. GET /trade-orders~where(status=~Cancelled)~take(20)
244. GET /trade-orders~where(status!~Cancelled)~take(20)
245. GET /trade-orders~just(identifiers, status)~where(status=~Shipped)
```

### Filtering by Amount
```
246. GET /trade-orders~where(totalAmount>1000)~take(20)
247. GET /trade-orders~where(totalAmount<500)~take(20)
248. GET /trade-orders~where(balanceAmount>0)~take(20)
249. GET /trade-orders~where(balanceAmount=0)~take(20)
250. GET /trade-orders~orderBy(totalAmount:desc)~take(10)
```

### With Payments and Shipments
```
251. GET /trade-orders~with(payments)~take(10)
252. GET /trade-orders~just(identifiers, paymentCount:payments~count)~take(50)
253. GET /trade-orders~with(shipments)~take(10)
254. GET /trade-orders~just(identifiers, shipmentCount:shipments~count)~take(50)
255. GET /trade-orders~with(payments~just(limitAmount, authorizedAmount, method), shipments~just(status))~take(5)
```
Note: Query 255 uses `limitAmount` and `authorizedAmount` — payment orders don't have an `amount` field. Use `limitAmount` for the maximum allowed and `authorizedAmount` for what's been authorized.

### With Addresses
```
256. GET /trade-orders~with(invoiceAddresses, deliveryAddresses)~take(10)
257. GET /trade-orders~just(identifiers, invoiceAddresses~first, deliveryAddresses~first)~take(20)
258. GET /trade-orders~where(deliveryAddresses~count>0)~take(20)
259. GET /trade-orders~with(deliveryAddresses~just(line1, cityName, countryCode))~take(10)
260. GET /trade-orders~just(identifiers, deliveryCity:deliveryAddresses~first/cityName)~take(50)
```

### Complex Combinations
```
261. GET /trade-orders~where(status=~New)~with(items~just(product/name, quantity))~orderBy(timestamp:desc)~take(10)
262. GET /trade-orders~just(timestamp, totalAmount, customer~just(name), itemCount:items~count)~take(20)
263. GET /trade-orders~with(items~with(product~just(name, gtin)))~take(5)
264. GET /trade-orders~where(totalAmount>100)~with(customer~just(name,@type), seller:sellers~first~just(name))~take(10)
265. GET /trade-orders~with(items~with(product~with(categories~just(category/name))))~take(3)
```

---

## 9. Prices Queries (266-285)

### Basic
```
266. GET /prices~just(identifiers, amount)~take(50)
267. GET /prices~take(100)
268. GET /prices~count
269. GET /prices~orderBy(amount:desc)~take(20)
270. GET /prices~where(amount>0)~take(50)
```

### With Currency
```
271. GET /prices~with(currency)~take(20)
272. GET /prices~just(amount, currencyCode:currency/identifiers/currencyCode)~take(50)
273. GET /prices~where(currency/identifiers/currencyCode=SEK)~take(20)
274. GET /prices~just(identifiers, amount, currency~just(identifiers/currencyCode))~take(50)
275. GET /prices~where(currency/identifiers/currencyCode=EUR)~orderBy(amount)~take(20)
```

### With Sellers/Buyers
```
276. GET /prices~with(sellers)~take(20)
277. GET /prices~just(amount, sellers~just(name)~first)~take(50)
278. GET /prices~with(buyers)~take(20)
279. GET /prices~just(amount, sellerNames:sellers~just(name), buyerNames:buyers~just(name))~take(20)
280. GET /prices~where(sellers~count>0)~take(50)
```

### Complex
```
281. GET /prices~with(sellers~just(name, @type), currency)~take(10)
282. GET /prices~just(amount, currency/identifiers/currencyCode, firstSeller:sellers~first/name)~take(50)
283. GET /prices~where(sellers~count>1)~with(sellers~just(name))~take(10)
284. GET /prices~with(sellers~just(name,@type))~take(5)
285. GET /prices~orderBy(amount:desc)~with(currency~just(identifiers))~take(10)
```
Note: Query 284 corrected — `sellers` are `agent[]`, and `owner` is only available on `store` (not on the base `agent` type). Use `~just(name,@type)` or `~with(contactMethods)` instead.

---

## 10. Stock & Transactions Queries (286-300)

### Stock Places
```
286. GET /stock-places~just(name, identifiers)~take(50)
287. GET /stock-places~with(children)~take(10)
288. GET /stock-places~just(name, childCount:children~count)~take(50)
289. GET /stock-places~with(parent)~take(20)
290. GET /stock-places~where(!parent)~take(20)
```

### Stock Place Transactions (via stock-places)
Note: `/stock-transactions` is available as a top-level endpoint. `/stock-places~with(transactions)` is an alternative approach via stock place context.
```
291. GET /stock-places~with(transactions~take(10))~take(5)
292. GET /stock-places~with(transactions~orderBy(timestamp:desc)~take(10))~take(5)
293. GET /stock-places~with(transactionItems~take(10))~take(5)
294. GET /stock-places~with(entries~take(10))~take(5)
295. GET /stock-places~with(owner~just(name))~take(20)
```

### Complex Stock Queries
```
296. GET /stock-places~with(entries~where(availableQuantity>0))~take(10)
297. GET /stock-places~with(entries~just(product/name, physicalQuantity, availableQuantity)~take(10))~take(5)
298. GET /stock-places~just(name, owner/name, entryCount:entries~count)~take(20)
299. GET /stock-places~with(parent~just(name), children~just(name)~take(5))~take(10)
300. GET /stock-places~where(!parent)~with(children~with(children~just(name)))~take(5)
```

---

## Notes

- All queries use `GET` method
- Paths use camelCase for nested members
- Multiple predicates in `~where()` are AND-combined using `,` or `&`
- The `~first` operator returns single element instead of array
- The `~count` operator returns numeric count
- Aliases use `alias:path` syntax (e.g., `supplierName:supplierAgent/name`)
