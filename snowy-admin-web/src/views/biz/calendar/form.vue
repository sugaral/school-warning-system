<template>
	<xn-form-container title="新增校历排除日" :width="500" :visible="visible" :destroy-on-close="true" @close="onClose">
		<a-form ref="formRef" :model="formData" :rules="formRules" layout="vertical">
			<a-form-item label="作用范围：" name="scope">
				<a-radio-group v-model:value="formData.scope">
					<a-radio value="school">全校统一排除日</a-radio>
					<a-radio value="org">指定学院排除日</a-radio>
				</a-radio-group>
			</a-form-item>
			<a-form-item v-if="formData.scope === 'org'" label="所属学院：" name="scopeId">
				<a-tree-select
					v-model:value="formData.scopeId"
					class="xn-wd"
					placeholder="请选择学院"
					:tree-data="treeData"
					:field-names="{ children: 'children', label: 'name', value: 'id' }"
					tree-line
					allow-clear
				/>
			</a-form-item>
			<a-form-item label="排除日期：" name="exclusionDate">
				<a-date-picker
					v-model:value="formData.exclusionDate"
					class="xn-wd"
					value-format="YYYY-MM-DD"
					format="YYYY-MM-DD"
				/>
			</a-form-item>
			<a-form-item label="排除原因：" name="reason">
				<a-input v-model:value="formData.reason" placeholder="例如：法定节假日、校运会、全校停课演练" allow-clear />
			</a-form-item>
		</a-form>
		<template #footer>
			<a-button class="xn-mr8" @click="onClose">关闭</a-button>
			<a-button type="primary" :loading="submitLoading" @click="onSubmit">保存</a-button>
		</template>
	</xn-form-container>
</template>

<script setup name="bizCalendarForm">
	import { required } from '@/utils/formRules'
	import bizCalendarApi from '@/api/biz/bizCalendarApi'

	const emit = defineEmits({ successful: null })

	const visible = ref(false)
	const formRef = ref()
	const formData = ref({})
	const submitLoading = ref(false)
	const treeData = ref([])

	const formRules = {
		scope: [required('请选择作用范围')],
		exclusionDate: [required('请选择排除日期')],
		scopeId: [required('请选择所属学院')]
	}

	const onOpen = () => {
		visible.value = true
		formData.value = { scope: 'school' }
		bizCalendarApi.orgTreeSelector().then((res) => {
			treeData.value = res || []
		})
	}

	const onClose = () => {
		visible.value = false
	}

	const onSubmit = () => {
		formRef.value
			.validate()
			.then(() => {
				submitLoading.value = true
				bizCalendarApi
					.calendarAdd(formData.value)
					.then(() => {
						visible.value = false
						emit('successful')
					})
					.finally(() => {
						submitLoading.value = false
					})
			})
			.catch(() => {})
	}

	defineExpose({ onOpen })
</script>
