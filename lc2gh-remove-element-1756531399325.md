# Remove Element
- **Slug:** remove-element
- **Difficulty:** Easy
- **Language:** —
- **Runtime / Memory:** — / —
- **Source:** https://leetcode.com/problems/remove-element/submissions/1753102643/
- **Captured:** 2025-08-30T05:23:19.322Z

## Code
```
class Solution(object):
    def removeElement(self, nums, val):
        """
        :type nums: List[int]
        :type val: int
        :rtype: int
        """
        k = 0
        for x in nums:
            if x != val:
                nums[k] = x
                k += 1
        return k

```
